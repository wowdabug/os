import { 
    MEM,
    MODE, 
    TYPE, 
    OP, 
    TYPE_SIZES, 
    TYPE_SUFFIXES, 
    OP_MODES,
    OP_TYPES 
} from "./main.js";

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
        throw new Error("invalid opcode: " + str + ", " + type)
    }

    return opcode;
}

// to be class-ified
const globalFlags = {
    float: false,
    signed: false
};

function parseNum(str) {
    globalFlags.float = false;
    globalFlags.signed = false;
    if (str === 'Infinity' || str === '-Infinity') {
        return null;
    } else {
        let prevDigit = false;
        let point = false;
        for (let i = 0; i < str.length; ++i) {
            const char = str[i];
            const digit = isNumeric(char);
            if (char === '.') {
                globalFlags.float = true;
                if (i !== 0 && (point || !prevDigit)) {
                    return null;
                } else {
                    point = true;
                }

            } else if (!digit) {
                if (i === 0 && str.length !== 1 && char === '-') {
                    globalFlags.signed = true;
                } else {
                    return null;
                }
            }

            prevDigit = digit;
        }
    }

    return {
        type: 'num',
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
        type: 'var',
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
        type: 'char',
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
        type: 'str',
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
            if (escape) {
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

// add some getters/setters
class StaticAllocator {
    ptr;
    data = [];
    encoder;
    symbols;
    strs;

    constructor(offset) {
        this.ptr = offset;
        this.data = [];
        this.encoder = new TextEncoder();
        this.symbols = new Map();
        this.strs = new Map();
    }

    alloc(bytes) {
        if (this.ptr + bytes <= MEM.STATIC_REG_OFFSET + MEM.STATIC_REG_SIZE) {
            console.log(`allocated ${bytes} byte${bytes == 1 ? "" : "s"} at address ${this.ptr}`);
            this.ptr += bytes;
        } else {
            throw new Error("no static space");
        }

        return this.ptr - bytes;
    }

    // seperate into alloc and create methods
    allocVar(type, strs) {
        const addr = this.alloc(TYPE_SIZES[type]);
        this.data.push(getBytes(type, parseNum(strs[1] || 0).value), addr);
        this.symbols.set(strs[0], {type: type, value: addr});
    }

    allocArr(type, strs) {
        const size = parseNum(strs[1]).value;
        const addr = this.alloc(TYPE_SIZES[type] * size);
        const bytes = [];
        for (let i = 2; i < size + 2; ++i) { bytes.push(...getBytes(type, parseNum(strs[i] || 0).value)); }
        this.data.push(bytes, addr);
        this.symbols.set(strs[0], addr);
    }

    allocStr(str) {
        if (this.strs.has(str)) {
            return this.strs.get(str);
        } else {
            const bytes = []
            bytes.push(...this.encoder.encode(str), 0);
            const addr = this.alloc(bytes.length);
            this.data.push(bytes, addr);
            this.strs.set(str, addr);
            return addr;
        }
    }
}

export function compile(text) {
    const start = performance.now();

    const insts = getInsts(text);

    const tokens = new ArrayBuffer(MEM.MAX_INSTS * MEM.MAX_TOKENS * 4);
    const tokensI32 = new Uint32Array(tokens);
    const tokensF32 = new Float32Array(tokens);
    const debugTokens = [];

    const allocator = new StaticAllocator(MEM.STATIC_REG_OFFSET);

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

        switch (opcode) {
            case 'b':
                allocator.allocVar(TYPE.BYTE, operands);
                continue;
            case 'i':
                allocator.allocVar(TYPE.INT, operands);
                continue;
            case 'f':
                allocator.allocVar(TYPE.FLOAT, operands);
                continue;
            case 'c': {
                const char = parseChar(operands[1]).value.charCodeAt(0);
                const addr = allocator.alloc(1);
                allocator.data.push([char], addr);
                allocator.symbols.set(operands[0], {type: TYPE.BYTE, value: addr});
                continue;
            }
            case 's': {
                const str = parseStr(operands[1]).value;
                const addr = allocator.allocStr(str);
                allocator.symbols.set(operands[0], {type: TYPE.INT, value: addr});
                continue;
            }
            case 'ba':
                allocator.allocArr(TYPE.BYTE, operands);
                continue;
            case 'ia':
                allocator.allocArr(TYPE.INT, operands);
                continue;
            case 'fa':
                allocator.allocArr(TYPE.FLOAT, operands);
                continue;
            case 'lbl':
                allocator.symbols.set(operands[0], {type: TYPE.INT, value: j - 1});
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
                throw new Error("operand invalid");
            }

            if (parsed.type === 'num') {
                let num = parsed.value;
                const opcodeId = OP[opcode.toUpperCase()];

                if (mode === MODE.DIR || OP_MODES[opcodeId] === MODE.DIR) {
                    if (globalFlags.float || globalFlags.signed) {
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
                    if (globalFlags.float) {
                        type = TYPE.FLOAT;
                        tokensF32[operandOffset] = num;
                    } else {
                        if (globalFlags.signed) {
                            type = TYPE.INT;
                        }
                        
                        tokensI32[operandOffset] = num;
                    }
                }

            } else if (parsed.type === 'var') {
                if (!allocator.symbols.has(parsed.value)) {
                    throw new Error("var not declared: " + parsed.value);
                }

                const data = allocator.symbols.get(parsed.value);
                type = data.type;
                tokensI32[operandOffset] = data.value;
            } else if (parsed.type === 'char') {
                type = TYPE.BYTE;
                tokensI32[operandOffset] = parsed.value.charCodeAt(0);
            } else if (parsed.type === 'str') { 
                type = TYPE.INT;
                const addr = allocator.allocStr(parsed.value);
                tokensI32[operandOffset] = addr;
            }
        } else {
            tokensI32[operandOffset] = 0;
        }

        const opcodeId = getOpcode(opcode, type);
        if (!opcodeId) {
            throw new Error("unsupported type");
        }

        const opcodeType = OP_TYPES[opcodeId];
        if (!type) {
            type = opcodeType;
        } else if (opcodeType != type) {
            throw new Error("mismatched types: " + opcodeType + ", " + type);
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
        data: allocator.data
    };
}
