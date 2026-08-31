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

function split(str, delimeter, keepEscape) {
    str = str.replaceAll('\r', "");
    const arr = [];
    let escape = false;
    let substring = "";
    for (let i = 0; i < str.length; ++i) {
        if (str[i] === '"') {
            escape = !escape;
            if (keepEscape) substring += '"';
        } else if (!escape && str[i] === delimeter) {
            arr.push(substring);
            substring = "";
        } else {
            substring += str[i];
        }
    }

    arr.push(substring);
    return arr;
}

let OP;
let names;
let types;

async function init() {
    const response = await fetch("insts.json");
    const data = await response.json();

    OP = Object.fromEntries(data.map((el, i) => [el.opcode, i]));
    names = Object.fromEntries(data.flatMap((el, i) => el.names.map(name => [name, i])));
    types = data.map((el) => getType(el.type));
}

function compile(program) {
    const tokens = new Int32Array(MAX_INSTRUCTIONS * MAX_TOKENS);
    const symbolTable = new Map();
    
    const debugTokens = [];
    const output = [];

    let insts = split(program, '\n', true);
    let staticPtr = STATIC_OFFSET;

    // for padding and correct array access
    const allocateStatic = (operand, bytes, offset) => {
        staticPtr += (offset - staticPtr % offset) % offset;
        if (staticPtr + bytes <= STATIC_OFFSET + STATIC_SIZE) {
            symbolTable.set(operand, staticPtr);
            console.log(`allocated ${bytes} byte${bytes == 1 ? "" : "s"} for ${operand} at address ${staticPtr}`);
            staticPtr += bytes;
        } else {
            throw new Error("no static space");
        }

        return staticPtr - bytes;
    };

    const parseOperand = (operand) => {
        if (operand &&
            operand.length === 3 &&
            operand[0] === '\'' &&
            operand[2] === '\''
        ) {
            return operand[1].charCodeAt(0);
        } else {
            return operand;
        }
    };

    let j = 0;
    for (let i = 0; i < insts.length; ++i) {
        const [opcode, ...operands] = split(insts[i], ' ');
    
        operands.forEach((operand, index) => {
            operands[index] = parseOperand(operand);
        });

        switch (opcode) {
            case "":
                break;
            case "i32":
                memI32[allocateStatic(operands[0], 4, 4) >> 2] = operands[1] || 0;
                break;
            case "u8":
                memU8[allocateStatic(operands[0], 1, 1)] = operands[1] || 0;
                break;
            case "i32v": {
                let addr = allocateStatic(operands[1], 4 * operands[0], 4);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    memI32[addr >> 2] = operands[i] || 0;
                    addr += 4;
                }
                break;
            }
            case "s": {
                const bytes = encoder.encode(operands[1]);
                const addr = allocateStatic(operands[0], bytes.length + 1, 1);
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

    insts = output;

    for (let i = 0; i < insts.length; ++i) {
        let [name, operand] = split(insts[i], ' ');
        const base = i * MAX_TOKENS;
        const opcodeOffset = base;
        const typeOffset = base + 1;
        const modeOffset = base + 2;
        const operandOffset = base + 3;

        operand = parseOperand(operand);

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
                memI32[value >> 2] = acc;
                break;
            case OP.DEREF_I32:
                acc = memI32[value >> 2] | 0;
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
                terminal.out(value);
                break;
            case OP.LOAD_U8:
                acc = value | 0;
                break;
            case OP.STORE_U8:
                memU8[value] = acc;
                break;
            case OP.DEREF_I32:
                acc = memU8[value] | 0;
                break;
            case OP.OUT_C:
                terminal.out(String.fromCharCode(value));
                break;
            case OP.OUT_S:
                let end = value;
                while (memU8[end] !== 0) ++end;
                terminal.out(decoder.decode(memU8.subarray(value, end)));
                break;
            case OP.JMP:
                i = value;
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
