import { 
    STATIC_REG_OFFSET,
    STATIC_REG_SIZE,
    MAX_INSTRUCTIONS,
    MAX_TOKENS,
    TYPE,
    MODE,
    names,
    types,
    modes
} from "./loader.js";

const encoder = new TextEncoder();

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

let staticData = [];
let staticPtr = STATIC_REG_OFFSET;

function staticAlloc(bytes) {
    if (staticPtr + bytes <= STATIC_REG_OFFSET + STATIC_REG_SIZE) {
        console.log(`allocated ${bytes} byte${bytes == 1 ? "" : "s"} at address ${staticPtr}`);
        staticPtr += bytes;
    } else {
        throw new Error("no static space");
    }

    return staticPtr - bytes;
}

function getBytes(value) {
    return [
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff
    ];
}

function preprocess(text, symbolTable) {
    let insts = split(text, '\n').map(el => el.trim());
    const output = [];

    const loopStack = [];

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
                const addr = staticAlloc(4);
                staticData.push(getBytes(operands[1] || 0), addr);
                symbolTable.set(operands[0], addr);
                break;
            }
            case "u8": {
                const addr = staticAlloc(1);
                staticData.push([operands[1] || 0], addr);
                symbolTable.set(operands[0], addr);
                break;
            }
            case "i32v": {
                let addr = staticAlloc(4 * operands[0]);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    staticData.push(getBytes(operands[i] || 0), addr);
                    addr += 4;
                }

                break;
            }
            case "u8v": {
                let addr = staticAlloc(operands[0]);
                symbolTable.set(operands[1], addr);
                for (let i = 2; i < 2 + operands[0]; ++i) {
                    staticData.push([operands[1] || 0], addr);
                    ++addr;
                }

                break;
            }
            case "s": {
                operands[1] = parseStr(operands[1]);
                const bytes = encoder.encode(operands[1]);
                const addr = staticAlloc(bytes.length + 1);
                symbolTable.set(operands[0], addr);
                staticData.push(bytes, addr);
                staticData.push(0, addr + bytes.length);
                break;
            }
            case "lbl":
                symbolTable.set(operands[0], j - 1);
                break;
            case "std_loop": {
                const index = operands[0];
                const min = operands[1];

                loopStack.push({
                    ptr: j + 1,
                    index: index,
                    min: min,
                    max: operands[2]
                });

                output.push(
                    "load " + min,
                    "store " + index
                );
                
                j += 2;
                break;
            }
            case "std_loop_end": {
                const { ptr, index, max } = loopStack.pop();

                output.push(
                    "load @" + index,
                    "add 1",
                    "store " + index,
                    "cmp " + max,
                    "ifne",
                    "jmp " + ptr
                );

                j += 6;
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

export function compile(text) {
    const start = performance.now();

    const tokens = new Int32Array(MAX_INSTRUCTIONS * MAX_TOKENS);
    const symbolTable = new Map();
    const debugTokens = [];
    
    const insts = preprocess(text, symbolTable);

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

    console.log("compile ms: " + (performance.now() - start) + '\n');
    console.log(debugTokens);

    return {
        tokens: tokens,
        staticData: staticData,
        entryPoint: 0
    };
}
