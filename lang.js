import { terminal } from "./terminal.js";

const RAM_SIZE = 1024 * 1024;

const SYS_REG_OFFSET = 0;
const SYS_REG_SIZE = 64;

const USER_REG_OFFSET = 64;
const USER_REG_SIZE = 64;

const STATIC_REG_OFFSET = 128;
const STATIC_REG_SIZE = 64 * 1024;

// TODO: implement heap
const HEAP_OFFSET = 128 + (64 * 1024);
const HEAP_SIZE = RAM_SIZE - HEAP_OFFSET; 

const MAX_TOKENS = 4;
const MAX_INSTRUCTIONS = 1024;

const TYPE = {
    NONE: 0,
    I32: 1,
    U8: 2
};

const MODE = {
    IMM: 0,
    DIR: 1,
};

const OPMODE = {
    IMM: 0,
    DIR: 1,
    SYS: 2 
}

const buffer = new ArrayBuffer(RAM_SIZE);
const view = new DataView(buffer);
const U8array = new Uint8Array(buffer);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getType(str) {
    switch (str) {
        case "PTR":
        case "I32":
            return TYPE.I32;
        case "U8":
            return TYPE.U8;
        default:
            return TYPE.NONE;
    }
}

function getMode(str) {
    switch (str) {
        case "IMM":
            return OPMODE.IMM;
        case "DIR":
            return OPMODE.DIR;
        default:
            return OPMODE.IMM;
    }
}

function getSize(type) {
    switch (type) {
        case TYPE.I32:
            return 4;
        case TYPE.U8:
            return 1;
        default:
            throw new Error("???");
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
let modes;

const allocator = {
    staticPtr: STATIC_REG_OFFSET,

    staticAlloc(bytes) {
        if (this.staticPtr + bytes <= STATIC_REG_OFFSET + STATIC_REG_SIZE) {
            console.log(`allocated ${bytes} byte${bytes == 1 ? "" : "s"} at address ${this.staticPtr}`);
            this.staticPtr += bytes;
        } else {
            throw new Error("no static space");
        }

        return this.staticPtr - bytes;
    },

    heapInit() {
        // TODO
    },

    heapAlloc() {
        // TODO
    },

    heapFree() {
        // TODO
    }
};

async function init() {
    const response = await fetch("insts.json");
    const data = await response.json();

    OP = Object.fromEntries(data.map((el, i) => [el.opcode, i]));
    names = Object.fromEntries(data.flatMap((el, i) => el.names.map(name => [name, i])));
    types = data.map((el) => getType(el.type));
    modes = data.map((el) => getMode(el.mode || "IMM"));
}

function preprocess(program, symbolTable) {
    let insts = split(program, '\n');
    const output = [];

    let loopPtr;
    let loopIndex;
    let loopMin;
    let loopMax;

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
                const addr = allocator.staticAlloc(4);
                view.setInt32(addr, operands[1] || 0, true);
                symbolTable.set(operands[0], addr);
                break;
            }
            case "u8": {
                const addr = allocator.staticAlloc(1);
                U8array[addr] = operands[1] || 0;
                symbolTable.set(operands[0], addr);
                break;
            }
            case "i32v": {
                let addr = allocator.staticAlloc(4 * operands[0]);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    view.setInt32(addr, operands[i] || 0, true);
                    addr += 4;
                }

                break;
            }
            case "u8v": {
                let addr = allocator.staticAlloc(operands[0]);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    U8array[addr] = operands[i] || 0;
                    ++addr;
                }

                break;
            }
            case "s": {
                operands[1] = parseStr(operands[1]);
                const bytes = encoder.encode(operands[1]);
                const addr = allocator.staticAlloc(bytes.length + 1);
                symbolTable.set(operands[0], addr);
                U8array.set(bytes, addr);
                U8array[addr + bytes.length] = 0;
                break;
            }
            case "lbl": {}
                symbolTable.set(operands[0], j - 1);
                break;
            case "std_inc_u8": {
                const macroInsts = [
                    "load_u8 @" + operands[0],
                    "add_u8 1",
                    "store_u8 " + operands[0]
                ];

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
            case "std_dec_u8": {
                const macroInsts = [
                    "load_u8 @" + operands[0],
                    "sub_u8 1",
                    "store_u8 " + operands[0]
                ];

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
            case "std_inc_i32": {
                const macroInsts = [
                    "load @" + operands[0],
                    "add 1",
                    "store " + operands[0]
                ];

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
            case "std_dec_i32": {
                const macroInsts = [
                    "load @" + operands[0],
                    "sub 1",
                    "store " + operands[0]
                ];

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
            case "std_loop": {
                loopPtr = j + 1;
                loopIndex = operands[0];
                loopMin = operands[1];
                loopMax = operands[2];

                const macroInsts = [
                    "load " + loopMin,
                    "store " + loopIndex,
                ];

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
            case "std_loop_end": {
                if (!loopPtr || !loopIndex || !loopMin || !loopMax) {
                    throw new Error("no begin inst")
                }

                const macroInsts = [
                    "load @" + loopIndex,
                    "add 1",
                    "store " + loopIndex,
                    "cmp " + loopMax,
                    "ifne",
                    "jmp " + loopPtr
                ];

                loopPtr = null;

                j += macroInsts.length;
                output.push(...macroInsts);
                break;
            }
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

        const opcodeId = names[name];
        tokens[opcodeOffset] = opcodeId;
        tokens[typeOffset] = types[opcodeId];

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

            let number = parseInt(slicedOperand); // write own
            if (Number.isNaN(number)) {
                if (symbolTable.has(slicedOperand)) {
                    tokens[operandOffset] = symbolTable.get(slicedOperand);
                } else {
                    throw new Error("no symbol: " + slicedOperand);
                }
            } else {
                if (mode == MODE.DIR || modes[opcodeId] == MODE.DIR) {
                    if (number < 0 ||
                        number > USER_REG_SIZE - getSize(types[opcodeId])
                    ) {
                        throw new Error("user reg index invalid");
                    }

                   number += USER_REG_OFFSET;
                }

                tokens[operandOffset] = number;
            }
        }

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
                    value = view.getInt32(operand, true);
                    break;
                case TYPE.U8:
                    value = U8array[operand];
                    break;
                default:
                    value = 0;
            }
        }
        
        switch (tokens[base]) {
            case OP.LOAD_U8:
                acc = value & 0xFF;
                break;
            case OP.STORE_U8:
                U8array[value] = acc & 0xFF;
                break;
            case OP.DEREF_U8:
                acc = U8array[value];
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
            case OP.OUT_U8:
            case OP.OUT_I32:
                terminal.out(value);
                break;
            case OP.LOAD_I32:
                acc = value | 0;
                break;
            case OP.STORE_I32:
                view.setInt32(value, acc, true);
                break;
            case OP.DEREF_I32:
                acc = view.getInt32(value, true);
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
            case OP.OUT_C:
                terminal.out(String.fromCharCode(value));
                break;
            case OP.OUT_S:
                let end = value | 0;
                while (U8array[end] !== 0) ++end;
                terminal.out(decoder.decode(U8array.subarray(value | 0, end)));
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
            case OP.IFL:
                if (cmp <= 0) ++i;
                break;
            case OP.IFLE:
                if (cmp < 0) ++i;
                break;
            case OP.IFG:
                if (cmp >= 0) ++i;
                break;
            case OP.IFGE:
                if (cmp > 0) ++i;
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
