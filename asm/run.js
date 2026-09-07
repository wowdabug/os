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

    let valU8 = 0;
    let valI32 = 0;
    let valF32 = 0;
    let accU8 = 0;
    let accI32 = 0;
    let accF32 = 0;
    let cmp = 0;

    for (let i = 0; i < data.length; i += 2) {
        memU8.set(data[i], data[i + 1]);
    }

    const start = performance.now();

    let i = 0;
    main: while (i < MEM.MAX_INSTS) {
        // benchmark outside loop
        const base = i << 2;
        const type = tokensI32[base + 1];
        const operand = tokensI32[base + 3];

        if (tokensI32[base] === MODE.IMM) {
            switch (type) {
                case TYPE.BYTE:
                    valU8 = operand;
                    break;
                case TYPE.INT:
                    valI32 = operand;
                    break;
                case TYPE.FLOAT:
                    valF32 = tokensF32[base + 3];
                    break;
            }

        } else {
            switch (type) {
                case TYPE.BYTE:
                    valU8 = memU8[operand];
                    break;
                case TYPE.INT:
                    valI32 = memView.getInt32(operand, true);
                    break;
                case TYPE.FLOAT:
                    valF32 = memView.getFloat32(operand, true);
                    break;
            }
        }

        // optimize opcode count
        switch (tokensI32[base + 2]) {
            case OP.LOAD_B:
                accU8 = valU8;
                break;
            case OP.LOAD_I:
                accI32 = valI32;
                break;
            case OP.LOAD_F:
                accF32 = valF32;
                break;
            case OP.STORE_B:
                memU8[valI32] = accU8;
                break;
            case OP.STORE_I:
                memView.setInt32(valI32, accI32, true);
                break;
            case OP.STORE_F:
                memView.setFloat32(valI32, accF32, true);
                break;
            case OP.DEREF_B:
                accU8 = memU8[valI32];
                break;
            case OP.DEREF_I:
                accI32 = memView.getInt32(valI32, true);
                break;
            case OP.DEREF_F:
                accF32 = memView.getFloat32(valI32, true);
                break;
            case OP.ADD_B:
                accU8 = (accU8 + valU8) & 0xFF;
                break;
            case OP.ADD_I:
                accI32 = (accI32 + valI32) | 0;
                break;
            case OP.ADD_F:
                accU8 = (accF32 + valF32);
                break;
            case OP.SHL_B:
                accU8 = (accU8 << valU8) & 0xFF;
                break;
            case OP.SHL_I:
                accI32 = (accI32 << valI32) | 0;
                break;
            case OP.OUT_B:
                terminal.outU8(valU8);
                break;
            case OP.OUT_I:
                terminal.outI32(valI32);
                break;
            case OP.OUT_F:
                terminal.outF32(valF32);
                break;
            case OP.OUT_C:
                terminal.outChar(valU8);
                break;
            case OP.OUT_S: {
                let end = valI32;
                while (memU8[end] !== 0) ++end;
                terminal.outStr(memU8.subarray(valI32, end | 0));
                break;
            }
            case OP.CMP_B:
                cmp = (valU8 > accU8) - (valU8 < accU8);
                break;
            case OP.CMP_I:
                cmp = (valI32 > accI32) - (valI32 < accI32);
                break;
            case OP.CMP_F:
                cmp = (valF32 > accF32) - (valF32 < accF32);
                break;
            case OP.IFE:
                if (cmp !== 0) ++i;
                break;
            case OP.IFNE:
                if (cmp === 0) ++i;
                break;
            case OP.IFL:
                if (cmp === -1) ++i;
                break;
            case OP.IFLE:
                if (cmp !== 1) ++i;
                break;
            case OP.IFG:
                if (cmp === 1) ++i;
                break;
            case OP.IFGE:
                if (cmp !== -1) ++i;
                break;
            case OP.JMP:
                i = valI32;
                break;
            case OP.HALT:
                break main;
            case OP.FLUSH:
                terminal.flush();
                break;
            default:
                throw new Error("opcode: " + tokensI32[base + 2]);
        }

        ++i;
    }

    console.log(performance.now() - start + ' ms');
}
