import { terminal } from "../terminal.js";
import {
    MEM,
    MODE,
    TYPE,
    OP
} from "./main.js";

export function run(program) {
    const { tokens, data } = program;
    const tokensI32 = new Int32Array(tokens);
    const tokensF32 = new Float32Array(tokens);

    const mem = new ArrayBuffer(MEM.MEM_SIZE);
    const memU8 = new Uint8Array(mem);
    const memView = new DataView(mem);

    for (let i = 0; i < data.length; i += 2) {
        memU8.set(data[i], data[i + 1]);
    }

    let val;
    let acc;

    const start = performance.now();

    let i = 0;
    main: while (i < MEM.MAX_INSTS) {
        // benchmark outside loop
        const base = i << 2;
        const type = tokens[base + 1];
        const operand = tokens[base + 3];

        // benchmark switch for immediates
        if (tokensI32[base] === MODE.IMM) {
            val = operand;
        } else {
            switch (tokensI32[base + 1]) {
                case TYPE.BYTE:
                    val = memU8[operand];
                    break;
                case TYPE.INT:
                    val = memView.getInt32(operand, true);
                    break;
                case TYPE.FLOAT:
                    val = memView.getFloat32(operand, true);
                    break;
                default:
                    val = 0;
            }
        }

        console.log(tokensI32[base + 2])

        switch (tokensI32[base + 2]) {
            case OP.LOAD_B:
                acc = val & 0xFF;
                break;
            case OP.LOAD_I:
                acc = val | 0;
                break;
            case OP.LOAD_F:
                acc = val;
                break;
            case OP.STORE_B:
                memU8[val | 0] = acc;
                break;
            case OP.STORE_I:
                acc = val | 0;
                break;
            case OP.STORE_F:
                acc = val;
                break;
            case OP.OUT_B:
                terminal.out(val & 0xFF);
                break;
            case OP.OUT_I:
                terminal.out(val | 0);
                break;
            case OP.OUT_F:
                terminal.out(val);
                break;
            case OP.HALT:
                break main;
            default:
                throw new Error("opcode: " + tokensI32[base + 2]);
        }

        ++i;
    }

    console.log(performance.now() - start + ' ms');
}
