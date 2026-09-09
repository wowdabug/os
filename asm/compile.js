import { 
    MEM,
    MODE, 
    TYPE, 
    OP, 
    TYPE_SIZES, 
    TYPE_SUFFIXES, 
    OP_MODES,
    OP_TYPES,
    PRE_OP,
    PRE_OP_TYPES
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

    if (opcode == null) {
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

function ensureRange(type, val) {
    switch (type) {
        case TYPE.BYTE:
            if (val < -256 || val >= 256) { throw new Error('byte out of range'); }
            break;
        case TYPE.INT:
            if (val < -2147483648 || val >= 2147483648) { throw new Error('int out of range'); }
            break;
        case TYPE.FLOAT:
            if (!Number.isFinite(Math.fround(val))) { throw new Error(`float out of range`); }
            break;
    }
}

export function compile(text) {
    const start = performance.now();

    const insts = getInsts(text);

    const tokens = new ArrayBuffer(MEM.MAX_INSTS * MEM.MAX_TOKENS * 4);
    const tokensI32 = new Uint32Array(tokens);
    const tokensF32 = new Float32Array(tokens);
    const debugTokens = [];

    staticPtr = MEM.STATIC_REG_OFFSET;

    let j = 0;
    for (let i = 0; i < insts.length; ++i) {
        const base = j * 4;
        const modeOffset = base + 0;
        const typeOffset = base + 1;
        const opcodeOffset = base + 2;
        const operandOffset = base + 3;

        const [opcode, ...operands] = insts[i];

        if (!opcode) {
            continue;
        }
        
        const pre = Object.hasOwn(PRE_OP, opcode.toUpperCase());

        let mode = MODE.NONE;

        const vals = [];
        const types = [];
        for (let i = 0; i < operands.length; ++i) {
            let operand = operands[i];
            if (operand[0] === '@') {
                if (pre) {
                    throw new Error('preprocessor vals cannot be direct');
                }

                mode = MODE.DIR;
                operand = operand.slice(1);
            } else {
                mode = MODE.IMM;
            }

            let parsed;
            if ((parsed = parseNum(operand)) !== null) {
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
                    types.push(TYPE.INT);
                    vals.push(num);
                } else {
                    if (opcode === 'store' || opcode === 'deref') {
                        throw new Error('type not provided');
                    }
                    
                    // add bound checking for u8 and i32
                    if (flagFloat) {
                        types.push(TYPE.FLOAT);
                        vals.push(num);
                    } else {
                        if (flagSigned) {
                            types.push(TYPE.INT);
                        } else {
                            types.push(TYPE.NONE);
                        }
                        
                        vals.push(num);
                    }
                }

            } else if ((parsed = parseVar(operand)) !== null) {
                // there are no variables in the preprocessor
                // so we just push the literal string
                if (pre) {
                    types.push(TYPE.NONE);
                    vals.push(parsed);
                    continue;
                }

                if (!staticSymbols.has(parsed)) {
                    throw new Error('var not declared: ' + parsed);
                }

                const data = staticSymbols.get(parsed);
                types.push(data.type);
                vals.push(data.val);
            } else if ((parsed = parseChar(operand)) !== null) {
                types.push(TYPE.BYTE);
                vals.push(parsed.charCodeAt(0));
            } else if ((parsed = parseStr(operand)) !== null) { 
                const addr = allocStr(parsed);
                types.push(TYPE.INT);
                vals.push(addr);
            } else {
                throw new Error('operand invalid: ' + operand);
            }

        }

        if (pre) {
            if (typeof vals[0] !== 'string') { throw new Error('invalid symbol'); }
            
            const preOpcodeId = PRE_OP[opcode.toUpperCase()];
            if (preOpcodeId == null) {
                throw new Error('invalid preprocessor opcode: ' + opcode);
            }

            const preOpcodeType = PRE_OP_TYPES[preOpcodeId];

            switch (preOpcodeId) {
                case PRE_OP.B:
                case PRE_OP.I:
                case PRE_OP.F: {
                    if (vals.length === 0) { throw new Error('not enough args'); }
                    if ((preOpcodeType === TYPE.BYTE || preOpcodeType === TYPE.INT) && types[1] === TYPE.FLOAT) { throw new Error('invalid type'); }
                    const val = vals[1] || 0;
                    ensureRange(preOpcodeType, val);
                    const addr = alloc(TYPE_SIZES[preOpcodeType]);
                    staticData.push(getBytes(preOpcodeType, val), addr);
                    staticSymbols.set(vals[0], { type: preOpcodeType, val: addr }); 
                    break;
                }
                    
                case PRE_OP.S: {
                    if (vals.length < 2) { throw new Error('not enough args'); }
                    if (types[1] === TYPE.FLOAT) { throw new Error('invalid type'); }
                    const val = vals[1];
                    ensureRange(TYPE.INT, val);
                    staticSymbols.set(vals[0], { type: TYPE.INT, val: val }); 
                    break;
                }
                    
                case PRE_OP.BA:
                case PRE_OP.IA:
                case PRE_OP.FA: {
                    if (vals.length < 2) { throw new Error('not enough args'); }
                    const size = vals[1];
                    if (types[1] === TYPE.FLOAT) { throw new Error('invalid size type'); }
                    ensureRange(TYPE.INT, size);
                    const addr = alloc(TYPE_SIZES[preOpcodeType] * size);
                    const bytes = [];
                    for (let i = 2; i < size + 2; ++i) { 
                        if ((preOpcodeType === TYPE.BYTE || preOpcodeType === TYPE.INT) && types[1] === TYPE.FLOAT) { throw new Error('invalid type'); }
                        const val = vals[i] || 0;
                        ensureRange(preOpcodeType, val);
                        bytes.push(...getBytes(preOpcodeType, val)); 
                    }

                    staticData.push(bytes, addr);
                    staticSymbols.set(vals[0], { type: preOpcodeType, val: addr }); 
                    break;
                }
                    
                case PRE_OP.LBL: {
                    staticSymbols.set(vals[0], { type: TYPE.INT, val: j - 1 });
                    break;
                }

                default: {
                    throw new Error('no preprocessor opcode logic');
                }
            }

            continue;
        } else {
            ++j;
        }

        let type = types[0];
        let val = vals[0];

        if (opcode === 'jmp') {
            console.log(vals)
        }

        const opcodeId = getOpcode(opcode, type);
        let opcodeType = OP_TYPES[opcodeId];

        if (!type) {
            type = opcodeType;
        } else if (opcodeType != type) {
            // surely I won't regret this
            //throw new Error('mismatched types: ' + opcode + ', ' + opcodeType + ', ' + type);
        }

        ensureRange(type, val);

        if (type === TYPE.FLOAT && mode === MODE.IMM) {
            tokensF32[operandOffset] = val;
            console.log(operands[0] + ', ' + type + ', ' + tokensF32[operandOffset])
        } else {
            tokensI32[operandOffset] = val;
        }

        tokensI32[modeOffset] = mode;
        tokensI32[typeOffset] = type;

        tokensI32[opcodeOffset] = opcodeId;
        
        debugTokens.push([tokensI32[modeOffset], tokensI32[typeOffset], opcode, tokensI32[opcodeOffset], operands[0], tokensI32[operandOffset]]);
    }

    console.log(staticSymbols)
    console.log(debugTokens);
    console.log(performance.now() - start + ' ms');

    return {
        tokens: tokens,
        data: staticData
    };
}
