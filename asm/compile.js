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

const ESCAPES = {
    '\'': '\'',
    '"': '"',
    '\\': '\\',
    'n': String.fromCharCode(10),
    't': String.fromCharCode(9),
    '0': String.fromCharCode(0)
};

function getOpcode(str, type) {
    let opcode;

    switch (str) {
        case 'load':
        case 'store':
        case 'deref':
        case 'add':
        case 'sub':
        case 'mul':
        case 'div':
        case 'mod':
        case 'and':
        case 'or':
        case 'xor':
        case 'not':
        case 'shl':
        case 'shr':
        case 'out':
        case 'cmp':
            opcode = OP[str.toUpperCase() + TYPE_SUFFIXES[type]];
            break;
        default:
            opcode = OP[str.toUpperCase()];
            break;
    }

    if (!opcode) {
        throw new Error('invalid opcode: ' + str + ', ' + type)
    }

    return opcode;
}

const PARSE_TYPE = {
    NONE: 0,
    NUM: 1,
    VAR: 2,
    CHAR: 3,
    STR: 4
};

let floatFlag = false;
let signedFlag = false;

let staticPtr;
const staticData = [];
const staticSymbols = new Map();
const staticStrs = new Map();
const encoder = new TextEncoder();

function parseNum(str) {
    floatFlag = false;
    signedFlag = false;
    if (str === 'Infinity' || str === '-Infinity') {
        return null;
    } else {
        let prevDigit = false;
        let point = false;
        for (let i = 0; i < str.length; ++i) {
            const char = str[i];
            const digit = isNumeric(char);
            if (char === '.') {
                floatFlag = true;
                if (i !== 0 && (point || !prevDigit)) {
                    return null;
                } else {
                    point = true;
                }

            } else if (!digit) {
                if (i === 0 && str.length !== 1 && char === '-') {
                    signedFlag = true;
                } else {
                    return null;
                }
            }

            prevDigit = digit;
        }
    }

    return {
        type: PARSE_TYPE.NUM,
        value: parseFloat(str),
    };
}

// to be optimized
function parseVar(str) {
    for (let i = 0; i < str.length; ++i) {
        const char = str[i]; 
        if (i === 0 && !(isLetter(char) || char === '_')) {
            return null;
        }

        if (!(isAlphanumeric(char) || char === '_')) {
            return null;
        }
    }

    return {
        type: PARSE_TYPE.VAR,
        value: str
    };
}

function parseChar(str) {
    let char;

    if (str[0] !== '\'' || str[str.length - 1] !== '\'') {
        return null;
    }

    if (str.length === 3) {
        if (str[1] === '\\') {
            return null;
        }

        char = str[1];
    } else if (str.length === 4) {
        if (str[1] !== '\\') {
            return null;
        }

        const escape = ESCAPES[str[2]];
        if (!escape) {
            return null;
        }

        char = escape;
    } else {
        return null;
    }

    return {
        type: PARSE_TYPE.CHAR,
        value: char
    };
}

function parseStr(str) {
    if (str[0] !== '"' || str[str.length - 1] !== '"') {
        return null;
    }

    let substr = '';
    let escape = false;
    for (let i = 1; i < str.length - 1; ++i) {
        if (escape) {
            escape = false;
            substr += ESCAPES[str[i]];
        } else if (str[i] == '\\') {
            escape = true;
        } else {
            substr += str[i];
        }
    }

    if (escape) {
        return null;
    }

    return {
        type: PARSE_TYPE.STR,
        value: substr
    };
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

function allocVar(type) {
    return alloc(TYPE_SIZES[type]);
}

function allocArr(type, size) {
    return alloc(TYPE_SIZES[type] * size);
}

function allocChar() {
    return alloc(1);
}

function allocStr(str) {
    if (staticStrs.has(str)) {
        return staticStrs.get(str);
    } else {
        const bytes = []
        bytes.push(...encoder.encode(str), 0);
        const addr = alloc(bytes.length);
        staticData.push(bytes, addr);
        staticStrs.set(str, addr);
        return addr;
    }
}

function initVar(type, strs) {
    const addr = allocVar(type);
    staticData.push(getBytes(type, parseNum(strs[1] || 0).value), addr);
    staticSymbols.set(strs[0], {type: type, value: addr});
}

function initArr(type, strs) {
    const size = parseNum(strs[1]).value;
    const addr = allocArr(type, size);
    const bytes = [];
    for (let i = 2; i < size + 2; ++i) { 
        bytes.push(...getBytes(type, parseNum(strs[i] || 0).value)); 
    }

    staticData.push(bytes, addr);
    staticSymbols.set(strs[0], {type: type, value: addr});
}

function initChar(strs) {
    const char = parseChar(strs[1]).value.charCodeAt(0);
    const addr = allocChar();
    staticData.push([char], addr);
    staticSymbols.set(strs[0], {type: TYPE.BYTE, value: addr});
}

function initStr(strs) {
    const str = parseStr(strs[1]).value;
    const addr = allocStr(str);
    staticSymbols.set(strs[0], {type: TYPE.INT, value: addr});
}

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

        if (!opcode) {
            continue;
        }

        // seperate init / alloc by type 
        // allow chars in b and ba and strs in i and ia
        // maybe? put all logic here or after other parsing
        switch (opcode) {
            case 'b':
                initVar(TYPE.BYTE, operands);
                continue;
            case 'i':
                initVar(TYPE.INT, operands);
                continue;
            case 'f':
                initVar(TYPE.FLOAT, operands);
                continue;
            case 'c':
                initChar(operands);
                continue;
            case 's':
                initStr(operands);
                continue;
            case 'ba':
                initArr(TYPE.BYTE, operands);
                continue;
            case 'ia':
                initArr(TYPE.INT, operands);
                continue;
            case 'fa':
                initArr(TYPE.FLOAT, operands);
                continue;
            case 'lbl':
                staticSymbols.set(operands[0], {type: TYPE.INT, value: j - 1});
                continue;
            default:
                ++j;
                break;
        }

        let operand = operands[0];

        let mode = MODE.NONE;
        let type = TYPE.NONE;

        if (operand) {
            if (operand[0] === '@') {
                mode = MODE.DIR;
                operand = operand.slice(1);
            } else {
                mode = MODE.IMM;
            }

            let parsed = 
                parseNum(operand) ??
                parseVar(operand) ??
                parseChar(operand) ??
                parseStr(operand);

            if (!parsed) {
                throw new Error('operand invalid');
            }

            if (parsed.type === PARSE_TYPE.NUM) {
                let num = parsed.value;
                const opcodeId = OP[opcode.toUpperCase()];

                if (mode === MODE.DIR || OP_MODES[opcodeId] === MODE.DIR) {
                    if (floatFlag || signedFlag) {
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
                    tokensI32[operandOffset] = num;
                } else {
                    if (opcode === 'store' || opcode === 'deref') {
                        throw new Error('type not provided');
                    }
                    
                    // add bound checking
                    if (floatFlag) {
                        type = TYPE.FLOAT;
                        tokensF32[operandOffset] = num;
                    } else {
                        if (signedFlag) {
                            type = TYPE.INT;
                        }
                        
                        tokensI32[operandOffset] = num;
                    }
                }

            } else if (parsed.type === PARSE_TYPE.VAR) {
                if (!staticSymbols.has(parsed.value)) {
                    throw new Error('var not declared: ' + parsed.value);
                }

                const data = staticSymbols.get(parsed.value);
                type = data.type;
                tokensI32[operandOffset] = data.value;
            } else if (parsed.type === PARSE_TYPE.CHAR) {
                type = TYPE.BYTE;
                tokensI32[operandOffset] = parsed.value.charCodeAt(0);
            } else if (parsed.type === PARSE_TYPE.STR) { 
                type = TYPE.INT;
                const addr = allocStr(parsed.value);
                tokensI32[operandOffset] = addr;
            }
        } else {
            tokensI32[operandOffset] = 0;
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

        tokensI32[opcodeOffset] = opcodeId;

        tokensI32[modeOffset] = mode;
        tokensI32[typeOffset] = type;
        
        debugTokens.push([tokensI32[modeOffset], tokensI32[typeOffset], opcode, tokensI32[opcodeOffset], operand, tokensI32[operandOffset]]);
    }

    console.log(debugTokens);
    console.log(performance.now() - start + ' ms');

    return {
        tokens: tokens,
        data: staticData
    };
}
