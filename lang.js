import { terminal } from "./terminal.js";

const RAM_SIZE = 1024 * 1024;

const REG_OFFSET = 0;
const REG_SIZE = 64;

const STATIC_OFFSET = 64;
const STATIC_SIZE = 64 * 1024;

const HEAP_OFFSET = 64 + (64 * 1024);
const HEAP_SIZE = RAM_SIZE - HEAP_OFFSET;

const MAX_TOKENS = 4;
const MAX_INSTRUCTIONS = 1024;

const OP = enumObject(
    "NONE",
    "LOAD_I32",
    "STORE_I32",
    "DEREF_I32",
    "ADD_I32",
    "SUB_I32",
    "MUL_I32",
    "DIV_I32",
    "CMP_I32",
    "OUT_I",
    "LOAD_U8",
    "STORE_U8",
    "DEREF_U8",
    "OUT_C",
    "OUT_S",
    "JMP",
    "IFE",
    "IFNE",
    "HALT"
);

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

function enumObject(...names) {
    return Object.fromEntries(names.map((name, i) => [name, i]));
}

function split(str, delimeter, keepEscape) {
    str = str.replaceAll('\r', "");
    const arr = [];
    let escape = false;
    let substring = "";
    for (let i = 0; i < str.length; ++i) {
        if (escape) {
            escape = false;
            substring += str[i];
        } else if (str[i] === '\\') {
            escape = true;
            if (keepEscape) substring += '\\';
        } else if (str[i] === delimeter) {
            arr.push(substring);
            substring = "";
        } else {
            substring += str[i];
        }
    }

    if (escape) {
        substring += "\\";
    }

    arr.push(substring);
    return arr;
}

function getOpcode(str) {
    switch (str) {
        case "load_i32":    
        case "load":
            return OP.LOAD_I32;
        case "store_i32":   
        case "store":
            return OP.STORE_I32;
        case "deref_i32":
        case "deref":
            return OP.DEREF_I32;
        case "add_i32":     
        case "add":
            return OP.ADD_I32;
        case "sub_i32":   
        case "sub":
            return OP.SUB_I32;
        case "mul_i32":   
        case "mul":  
            return OP.MUL_I32;
        case "div_i32":     
        case "div":
            return OP.DIV_I32;
        case "cmp_i32":
        case "cmp":
            return OP.CMP_I32;
        case "out_i":   
        case "out":    
            return OP.OUT_I;
        case "load_u8":
            return OP.LOAD_U8;
        case "store_u8":
            return OP.STORE_U8;
        case "deref_u8":
            return OP.DEREF_U8;
        case "out_c":       
            return OP.OUT_C;
        case "out_s":       
            return OP.OUT_S;
        case "jmp":         
            return OP.JMP;
        case "ife":
            return OP.IFE;
        case "ifne":
            return OP.IFNE;
        case "halt":        
            return OP.HALT;
        default:            
            return OP.NONE;
    }
}

function getType(opcode) {
    switch (opcode) {
        case OP.LOAD_I32:
        case OP.STORE_I32:
        case OP.DEREF_I32:
        case OP.ADD_I32:
        case OP.SUB_I32:
        case OP.MUL_I32:
        case OP.DIV_I32:
        case OP.CMP_I32:
        case OP.OUT_I:
        case OP.JMP:
            return TYPE.I32;
        case OP.LOAD_U8:
        case OP.STORE_U8:
        case OP.DEREF_U8:
        case OP.OUT_C:
        case OP.OUT_S:      
            return TYPE.U8;
        default:            
            return TYPE.NONE;
    }
}

function compile(program) {
    const start = performance.now();

    const tokens = new Int32Array(MAX_INSTRUCTIONS * MAX_TOKENS);
    const symbolTable = new Map();
    
    const debugTokens = [];
    const output = [];

    let instructions = split(program, '\n', true);
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

    let j = 0;
    for (let i = 0; i < instructions.length; ++i) {
        const [opcode, ...operands] = split(instructions[i], ' ');
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
                let addr = allocateStatic(operands[0], 4 * operands[1], 4);
                for (let i = 2; i < 2 + operands[1]; ++i) {
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
                output.push(instructions[i]);
                ++j;
                break;
        }
    }

    instructions = output;

    for (let i = 0; i < instructions.length; ++i) {
        const [opcode, operand] = split(instructions[i], ' ');
        const base = i * MAX_TOKENS;
        const opcodeOffset = base;
        const typeOffset = base + 1;
        const modeOffset = base + 2;
        const operandOffset = base + 3;

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
                    throw new Error("no symbol");
                }
            } else {
                tokens[operandOffset] = number;
            }
        }

        const opcodeId = getOpcode(opcode, mode);
        tokens[opcodeOffset] = opcodeId;
        tokens[typeOffset] = getType(opcodeId);
        tokens[modeOffset] = mode;

        debugTokens.push([opcode, tokens[opcodeOffset], operand, tokens[operandOffset]]);
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
            case OP.OUT_I:
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
                console.warn("no opcode");
                break;
        }

        ++i;
    }
}

export const lang = {
    compile,
    run
};
