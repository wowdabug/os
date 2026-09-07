import { 
    MEM,
    MODE, 
    TYPE, 
    OP, 
    TYPE_SIZES, 
    TYPE_SUFFIXES, 
    OP_MODES,
    OP_TYPES 
} from './main.js';

const ESCAPES = {
    '\'': '\'',
    '"': '"',
    '\\': '\\',
    'n': String.fromCharCode(10),
    't': String.fromCharCode(9),
    '0': String.fromCharCode(0)
};

let flagFloat = false;
let flagSigned = false;

let staticPtr = null;
const staticData = [];
const staticSymbols = new Map();
const staticStrs = new Map();
const staticEncoder = new TextEncoder();

function isLetter(char) {
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNumeric(char) {
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57;
}

function isAlphanumeric(char) {
    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function getOpcode(str, type) {
    const baseOpcodes = ['load', 'store', 'deref', 'add', 'sub', 'mul', 'div', 'mod', 'and', 'or', 'xor', 'not', 'shl', 'shr', 'out', 'in', 'cmp'];
    let opcode;

    if (baseOpcodes.includes(str)) {
        opcode = OP[str.toUpperCase() + TYPE_SUFFIXES[type]];
    } else {
        opcode = OP[str.toUpperCase()];
    }

    if (!opcode) {
        throw new Error('invalid opcode: ' + str + ', ' + type)
    }

    return opcode;
}

function parseNum(str, err) {
    flagFloat = false;
    flagSigned = false;
    if (str === 'Infinity' || str === '-Infinity') {
        return null;
    } else {
        let prevDigit = false;
        let point = false;
        for (let i = 0; i < str.length; ++i) {
            const char = str[i];
            const digit = isNumeric(char);
            if (char === '.') {
                flagFloat = true;
                if (i !== 0 && (point || !prevDigit)) {
                    if (err) { throw new Error(err); }
                    return null;
                } else {
                    point = true;
                }

            } else if (!digit) {
                if (i === 0 && str.length !== 1 && char === '-') {
                    flagSigned = true;
                } else {
                    if (err) { throw new Error(err); }
                    return null;
                }
            }

            prevDigit = digit;
        }
    }

    return parseFloat(str);
}

// to be optimized
function parseVar(str, err) {
    for (let i = 0; i < str.length; ++i) {
        const char = str[i]; 
        if (!isAlphanumeric(char) && char !== '_' ||
            i === 0 && !isLetter(char) && char !== '_'
        ) {
            if (err) { throw new Error(err); }
            return null;
        }
    }

    return str;
}

function parseChar(str, err) {
    let char;

    if (str[0] !== '\'' || str[str.length - 1] !== '\'') {
        return null;
    }

    if (str.length === 3) {
        if (str[1] === '\\') {
            if (err) { throw new Error(err); }
            return null;
        }

        char = str[1];
    } else if (str.length === 4) {
        if (str[1] !== '\\') {
            if (err) { throw new Error(err); }
            return null;
        }

        const escape = ESCAPES[str[2]];
        if (!escape) {
            if (err) { throw new Error(err); }
            return null;
        }

        char = escape;
    } else {
        if (err) { throw new Error(err); }
        return null;
    }

    return char;
}

function parseStr(str, err) {
    if (str[0] !== '"' || str[str.length - 1] !== '"') {
        if (err) { throw new Error(err); }
        return null;
    }

    let substr = '';
    let escape = false;
    for (let i = 1; i < str.length - 1; ++i) {
        if (escape) {
            escape = false;
            substr += ESCAPES[str[i]]; // add error here?
        } else if (str[i] == '\\') {
            escape = true;
        } else {
            substr += str[i];
        }
    }

    if (escape) {
        if (err) { throw new Error(err); }
        return null;
    }

    return substr;
}

function getInsts(text) {
    const instStrs = [];
    let substring = '';
    for (let i = 0; i < text.length; ++i) {
        const char = text[i];
        if (char === '\r') {
            continue;
        } else if (char === '\n') {
            instStrs.push(substring.trim());
            substring = '';
        } else {
            substring += char;
        }
    }

    const insts = [];
    for (let i = 0; i < instStrs.length; ++i) {
        const instStr = instStrs[i];
        const inst = [];
        let substr = '';
        let quote = null;
        let escape = false;
        for (let i = 0; i < instStr.length; ++i) {
            const char = instStr[i];
            if (!quote && char === '#') {
                break;
            } else if (escape) {
                escape = false;
                substr += char;
            } else if (quote && char === '\\') {
                escape = true;
                substr += char;
            } else if (char === quote) {
                quote = null;
                substr += char;
            } else if (!quote && (char === '\'' || char === '\"')) {
                quote = char;
                substr += char;
            } else if (!quote && char === ' ') {
                inst.push(substr);
                substr = '';
            } else {
                substr += char;
            }
        }

        if (substr) {
            inst.push(substr);
        }

        insts.push(inst);
    }

    return insts;
}

function getBytes(type, value) {
    const buffer = new ArrayBuffer(TYPE_SIZES[type]);
    const view = new DataView(buffer);

    switch (type) {
        case TYPE.BYTE:
            view.setUint8(0, value);
            break;
        case TYPE.INT:
            view.setInt32(0, value, true);
            break;
        case TYPE.FLOAT:
            view.setFloat32(0, value, true);
            break;
    }

    return new Uint8Array(buffer);
}

function alloc(bytes) {
    if (staticPtr + bytes <= MEM.STATIC_REG_OFFSET + MEM.STATIC_REG_SIZE) {
        console.log(`allocated ${bytes} byte${bytes == 1 ? '' : 's'} at address ${staticPtr}`);
        staticPtr += bytes;
    } else {
        throw new Error('no static space');
    }

    return staticPtr - bytes;
}

function allocStr(str) {
    if (staticStrs.has(str)) {
        return staticStrs.get(str);
    } else {
        const bytes = []
        bytes.push(...staticEncoder.encode(str), 0);
        const addr = alloc(bytes.length);
        staticData.push(bytes, addr);
        staticStrs.set(str, addr);
        return addr;
    }
}

/*
    function initVar(type, strs) {
        const addr = alloc(TYPE_SIZES[type]);
        staticData.push(getBytes(type, parseNum(strs[1] || 0, "invalid")), addr);
        staticSymbols.set(strs[0], { type: type, val: addr });
    }

    function initArr(type, strs) {
        const size = parseNum(strs[1]);
        const addr = alloc(TYPE_SIZES[type] * size);
        const bytes = [];
        for (let i = 2; i < size + 2; ++i) { 
            bytes.push(...getBytes(type, parseNum(strs[i] || 0))); 
        }

        staticData.push(bytes, addr);
        staticSymbols.set(strs[0], { type: type, val: addr });
    }
*/

// ensure type
const behaviors = {
    b(vals) {
        const addr = alloc(1);
        staticData.push(vals[1] || 0, addr);
        staticSymbols.set(vals[0], { type: TYPE.BYTE, val: addr }); 
    },

    i(vals) { 
        if (vals.length === 0) {
            throw new Error('not enough args');
        }

        const addr = alloc(4);
        console.log(vals[1])
        staticData.push(getBytes(TYPE.INT, vals[1] || 0), addr);
        staticSymbols.set(vals[0], { type: TYPE.INT, val: addr }); 
    },

    f(vals) {
        const addr = alloc(4);
        staticData.push(getBytes(TYPE.FLOAT, vals[1] || 0), addr);
        staticSymbols.set(vals[0], { type: TYPE.FLOAT, val: addr }); 
    },

    c(vals) { 
        staticSymbols.set(vals[0], { type: TYPE.BYTE, val: vals[1] || 0 }); 
    },

    s(vals) {
        staticSymbols.set(vals[0], { type: TYPE.INT, val: vals[1] || 0 }); 
    },

    ba() {

    },

    ia() {

    },

    fa() {

    },

    lbl() {
        staticSymbols.set(vals[0], { type: TYPE.INT, value: j - 1 });
    }
};

export function compile(text) {
    const start = performance.now();

    const insts = getInsts(text);

    const tokens = new ArrayBuffer(MEM.MAX_INSTS * MEM.MAX_TOKENS * 4);
    const tokensI32 = new Uint32Array(tokens);
    const tokensF32 = new Float32Array(tokens);
    const debugTokens = [];

    staticPtr = MEM.STATIC_REG_OFFSET;

    // refactor preprocessor
    let j = 0;
    for (let i = 0; i < insts.length; ++i) {
        const base = j * 4;
        const modeOffset = base + 0;
        const typeOffset = base + 1;
        const opcodeOffset = base + 2;
        const operandOffset = base + 3;

        const [opcode, ...operands] = insts[i];

        // is this needed?
        if (!opcode) {
            continue;
        }

        let mode = MODE.NONE;
        let type = TYPE.NONE;

        const preprocessor = Object.hasOwn(behaviors, opcode);

        const vals = [];
        for (let i = 0; i < operands.length; ++i) {
            let operand = operands[i];
            if (operand[0] === '@') {
                if (preprocessor) {
                    throw new Error('preprocessor vals cannot be direct');
                }

                mode = MODE.DIR;
                operand = operand.slice(1);
            } else {
                mode = MODE.IMM;
            }

            let parsed;
            if (parsed = parseNum(operand)) {
                let num = parsed;
                const opcodeId = OP[opcode.toUpperCase()];

                if (mode === MODE.DIR || OP_MODES[opcodeId] === MODE.DIR) {
                    if (flagFloat || flagSigned) {
                        throw new Error('register must be unsigned int');
                    }

                    const opcodeType = OP_TYPES[opcodeId];
                    if (!opcodeType) {
                        throw new Error('type not provided')
                    }

                    if (num < 0 || num > MEM.USER_REG_SIZE - TYPE_SIZES[opcodeType]) {
                        throw new Error('register range invalid');
                    }

                    num += MEM.USER_REG_OFFSET;
                    vals.push(num);
                } else {
                    if (opcode === 'store' || opcode === 'deref') {
                        throw new Error('type not provided');
                    }
                    
                    // add bound checking for u8 and i32
                    if (flagFloat) {
                        type = TYPE.FLOAT;
                        vals.push(num);
                    } else {
                        if (flagSigned) {
                            type = TYPE.INT;
                        }
                        
                        vals.push(num);
                    }
                }

            } else if (parsed = parseVar(operand)) {
                if (preprocessor) {
                    type = TYPE.NONE;
                    vals.push(parsed);
                    continue;
                }

                if (!staticSymbols.has(parsed)) {
                    throw new Error('var not declared: ' + parsed);
                }

                const data = staticSymbols.get(parsed);
                type = data.type;
                vals.push(data.val);
            } else if (parsed = parseChar(operand)) {
                type = TYPE.BYTE;
                vals.push(parsed.charCodeAt(0));
            } else if (parsed = parseStr(operand)) { 
                type = TYPE.INT;
                const addr = allocStr(parsed);
                vals.push(addr);
            } else {
                throw new Error('operand invalid');
            }

        }

        if (preprocessor) {
            behaviors[opcode](vals);
            continue;
        } else {
            ++j;
        }

        if (type === TYPE.FLOAT) {
            tokensF32[operandOffset] = vals[0];
        } else {
            tokensI32[operandOffset] = vals[0];
        }

        const opcodeId = getOpcode(opcode, type);
        if (!opcodeId) {
            throw new Error('unsupported type');
        }

        const opcodeType = OP_TYPES[opcodeId];
        if (!type) {
            type = opcodeType;
        } else if (opcodeType != type) {
            throw new Error('mismatched types: ' + opcodeType + ', ' + type);
        }

        tokensI32[modeOffset] = mode;
        tokensI32[typeOffset] = type;

        tokensI32[opcodeOffset] = opcodeId;
        
        debugTokens.push([tokensI32[modeOffset], tokensI32[typeOffset], opcode, tokensI32[opcodeOffset], operands[0], tokensI32[operandOffset]]);
    }

    console.log(debugTokens);
    console.log(performance.now() - start + ' ms');

    return {
        tokens: tokens,
        data: staticData
    };
}
