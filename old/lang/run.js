import {
    RAM_SIZE,
    MAX_INSTRUCTIONS,
    OP,
    TYPE,
    MODE,
} from "./loader.js";

import { client } from "../client/main.js";

const buffer = new ArrayBuffer(RAM_SIZE);
const view = new DataView(buffer);
const U8array = new Uint8Array(buffer);

const decoder = new TextDecoder();

export function run(program) {
    const { tokens, staticData, entryPoint } = program;

    console.log(staticData);

    // make custom set method to respect endianess!
    for (let i = 0; i < staticData.length; i += 2) {
        U8array.set(staticData[i], staticData[i + 1]);
    }

    let acc = 0;
    let cmp = 0;

    const start = performance.now();

    let i = entryPoint;
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
                client.out(value);
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
                client.out(String.fromCharCode(value));
                break;
            case OP.OUT_S:
                let end = value | 0;
                while (U8array[end] !== 0) ++end;
                client.out(decoder.decode(U8array.subarray(value | 0, end)));
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

    console.log("run ms: " + (performance.now() - start) + '\n')
}
