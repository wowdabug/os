import { terminal } from "./terminal.js";

const RAM_SIZE = 1024 * 1024;

const REG_OFFSET = 0;
const REG_SIZE = 64;

const STATIC_OFFSET = 64;
const STATIC_SIZE = 64 * 1024;

const HEAP_OFFSET = 64 + (64 * 1024);
const HEAP_SIZE = RAM_SIZE - HEAP_OFFSET; // fill the rest of space

const MAX_TOKENS = 4;
const MAX_INSTRUCTIONS = 1024;

const TYPE = {
    NONE: 0,
    I32: 1,
    U8: 2
};

const MODE = {
    NONE: 0,
    IMM: 1,
    DIR: 2
};

const NONE = 0;
const SOME = 1;
const FALSE = 0;
const TRUE = 1;

const mem = new ArrayBuffer(RAM_SIZE);
const memI32 = new Int32Array(mem);
const memU8 = new Uint8Array(mem);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getType(str) {
    switch (str) {
        case "I32":
            return TYPE.I32;
        case "U8":
            return TYPE.U8;
        default:
            return TYPE.NONE;
    }
}

function getEscape(char) {
    switch (char) {
        case '\'':
            return '\'';
        case '"':
            return '"';
        case '\\':
            return '\\';
        case 'n':
            return String.fromCharCode(10);
        case 't':
            return String.fromCharCode(9);
        case '0':
            return String.fromCharCode(0);
        default:
            throw new Error("invalid escape");
    }
}

function parseChar(str) {
    if (str &&
        str[0] === '\'' &&
        str[str.length - 1] === '\''
    ) {
        if (str.length === 3) {
            return str[1].charCodeAt(0);
        }

        if (str.length === 4 && str[1] === '\\') {
            return getEscape(str[2]).charCodeAt(0);
        } 

        throw new Error("invalid char: " + str);
    }

    return str;
}

function parseStr(str) {
    if (str &&
        str[0] === '"' &&
        str[str.length - 1] === '"'
    ) {
        let output = "";

        for (let i = 1; i < str.length - 1; ++i) {
            if (str[i] === '\\') {
                ++i;
                output += getEscape(str[i]);
            } else {
                output += str[i];
            }
        }

        return output;
    }

    return str;
}

function split(str, delimeter) {
    str = str.replaceAll('\r', "");

    const output = [];
    let quote = false;
    let escape = false;
    let substring = "";

    for (let i = 0; i < str.length; ++i) {
        const char = str[i];

        if (escape) {
            escape = false;
            substring += char;
        } else if (char === '\\') {
            escape = true;
            substring += char;
        } else if (char === quote) {
            quote = null;
            substring += char;
        } else if (!quote && (char === '\'' || char === '"')) {
            quote = char;
            substring += char;
        } else if (!quote && char === delimeter) {
            output.push(substring);
            substring = "";
        } else {
            substring += char;
        }
    }

    output.push(substring);
    return output;
}

let OP;
let names;
let types;

const allocator = {
    staticPtr: STATIC_OFFSET,

    staticAlloc(bytes, offset) {
        this.staticPtr += (offset - this.staticPtr % offset) % offset; // optimize to bitwise ops
        if (this.staticPtr + bytes <= STATIC_OFFSET + STATIC_SIZE) {
            console.log(`allocated ${bytes} byte${bytes == 1 ? "" : "s"} at address ${this.staticPtr}`);
            this.staticPtr += bytes;
        } else {
            throw new Error("no static space");
        }

        return this.staticPtr - bytes;
    },

    initHeap() {

    },

    heapAlloc() {

    }
};

async function init() {
    const response = await fetch("insts.json");
    const data = await response.json();

    OP = Object.fromEntries(data.map((el, i) => [el.opcode, i]));
    names = Object.fromEntries(data.flatMap((el, i) => el.names.map(name => [name, i])));
    types = data.map((el) => getType(el.type));
}

function preprocess(program, symbolTable) {
    let insts = split(program, '\n');
    const output = [];

    let j = 0;
    for (let i = 0; i < insts.length; ++i) {
        const [opcode, ...operands] = split(insts[i], ' ');
    
        operands.forEach((operand, index) => {
            operands[index] = parseChar(operand);
        });

        switch (opcode) {
            case "":
                break;
            case "ptr":
            case "i32": {
                const addr = memI32[allocator.staticAlloc(4, 4) >> 2] = operands[1] || 0;
                symbolTable.set(operands[0], addr);
                break;
            }
            case "u8": {
                const addr = memU8[allocator.staticAlloc(1, 1)] = operands[1] || 0;
                symbolTable.set(operands[0], addr);
                break;
            }
            case "i32v": {
                let addr = allocator.staticAlloc(4 * operands[0], 4);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    memI32[addr >> 2] = operands[i] || 0;
                    addr += 4;
                }

                break;
            }
            case "u8v": {
                let addr = allocator.staticAlloc(operands[0], 1);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    memI32[addr] = operands[i] || 0;
                    ++addr;
                }

                break;
            }
            case "s": {
                operands[1] = parseStr(operands[1]);
                const bytes = encoder.encode(operands[1]);
                const addr = allocator.staticAlloc(bytes.length + 1, 1);
                symbolTable.set(operands[0], addr);
                memU8.set(bytes, addr);
                memU8[addr + bytes.length] = 0;
                break;
            }
            case "lbl":
                symbolTable.set(operands[0], j - 1);
                break;
            default:
                output.push(insts[i]);
                ++j;
                break;
        }
    }

    return output;
}

function compile(program) {
    const tokens = new Int32Array(MAX_INSTRUCTIONS * MAX_TOKENS);
    const symbolTable = new Map();
    const debugTokens = [];
    
    const insts = preprocess(program, symbolTable);

    for (let i = 0; i < insts.length; ++i) {
        let [name, operand] = split(insts[i], ' ');
        const base = i * MAX_TOKENS;
        const opcodeOffset = base;
        const typeOffset = base + 1;
        const modeOffset = base + 2;
        const operandOffset = base + 3;

        operand = parseChar(operand);

        let mode = MODE.NONE;
        if (!operand) {
            tokens[operandOffset] = 0;
        } else {
            let slicedOperand;
            if (operand[0] === '@') {
                slicedOperand = operand.slice(1);
                mode = MODE.DIR;
            } else {
                slicedOperand = operand;
                mode = MODE.IMM;
            }

            const number = parseInt(slicedOperand); // write own
            if (Number.isNaN(number)) {
                if (symbolTable.has(slicedOperand)) {
                    tokens[operandOffset] = symbolTable.get(slicedOperand);
                } else {
                    throw new Error("no symbol: " + slicedOperand);
                }
            } else {
                tokens[operandOffset] = number;
            }
        }

        const opcodeId = names[name];
        tokens[opcodeOffset] = opcodeId;
        tokens[typeOffset] = types[opcodeId];
        tokens[modeOffset] = mode;

        debugTokens.push([name, tokens[opcodeOffset], operand, tokens[operandOffset]]);
    }

    console.log(debugTokens);

    return tokens;
}

function run(tokens) {
    let acc = 0;
    let cmp = 0;

    let i = 0;
    main: while (i < MAX_INSTRUCTIONS) {
        const base = i * 4;
        const operand = tokens[base + 3];

        let value;
        if (tokens[base + 2] === MODE.IMM) {
            value = operand;
        } else {
            switch (tokens[base + 1]) {
                case TYPE.I32:
                    value = memI32[operand >> 2];
                    break;
                case TYPE.U8:
                    value = memU8[operand];
                    break;
                default:
                    value = 0;
            }
        }
        
        switch (tokens[base]) {
            case OP.LOAD_I32:
                acc = value | 0;
                break;
            case OP.STORE_I32:
                memI32[value >> 2] = acc | 0;
                break;
            case OP.DEREF_I32:
                acc = memI32[value >> 2];
                break;
            case OP.ADD_I32:
                acc = (acc + value) | 0;
                break;
            case OP.SUB_I32:
                acc = (acc - value) | 0;
                break;
            case OP.MUL_I32:
                acc = (acc * value) | 0;
                break;
            case OP.DIV_I32:
                acc = (acc / value) | 0;
                break;
            case OP.CMP_I32:
                cmp = (acc - value) | 0;
                break;
            case OP.OUT_I32:
            case OP.OUT_U8:
                terminal.out(value);
                break;
            case OP.LOAD_U8:
                acc = value & 0xFF;
                break;
            case OP.STORE_U8:
                memU8[value] = acc & 0xFF;
                break;
            case OP.DEREF_U8:
                acc = memU8[value];
                break;
            case OP.ADD_U8:
                acc = (acc + value) & 0xFF;
                break;
            case OP.SUB_U8:
                acc = (acc - value) & 0xFF;
                break;
            case OP.MUL_U8:
                acc = (acc * value) & 0xFF;
                break;
            case OP.DIV_U8:
                acc = (acc / value) & 0xFF;
                break;
            case OP.CMP_U8:
                cmp = (acc - value) & 0xFF;
                break;
            case OP.ALLOC_U8:
                break;
            case OP.OUT_C:
                terminal.out(String.fromCharCode(value));
                break;
            case OP.OUT_S:
                let end = value | 0;
                while (memU8[end] !== 0) ++end;
                terminal.out(decoder.decode(memU8.subarray(value, end)));
                break;
            case OP.JMP:
                i = value | 0;
                break;
            case OP.IFE:
                if (cmp !== 0) ++i;
                break;
            case OP.IFNE:
                if (cmp === 0) ++i;
                break;
            case OP.HALT:
                break main;
            default:
                console.warn("no opcode: " + tokens[base]);
                break;
        }

        ++i;
    }
}

export const lang = {
    init,
    compile,
    run
};
