export const RAM_SIZE = 1024 * 1024;

// export const SYS_REG_OFFSET = 0;
// export const SYS_REG_SIZE = 64;

export const USER_REG_OFFSET = 64;
export const USER_REG_SIZE = 64;

export const STATIC_REG_OFFSET = 128;
export const STATIC_REG_SIZE = 64 * 1024;

// export const HEAP_OFFSET = 128 + (64 * 1024);
// export const HEAP_SIZE = RAM_SIZE - HEAP_OFFSET; 

export const MAX_TOKENS = 4;
export const MAX_INSTRUCTIONS = 1024;

export let OP;

export const TYPE = {
    NONE: 0,
    I32: 1,
    U8: 2
};

export const MODE = {
    IMM: 0,
    DIR: 1,
};

export let names;
export let types;
export let modes;

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
            return MODE.IMM;
        case "DIR":
            return MODE.DIR;
        default:
            return MODE.IMM;
    }
}

export async function load() {
    const response = await fetch("lang/insts.json");
    const data = await response.json();

    OP = Object.fromEntries(data.map((el, i) => [el.opcode, i]));

    names = Object.fromEntries(data.flatMap((el, i) => el.names.map(name => [name, i])));
    types = data.map((el) => getType(el.type));
    modes = data.map((el) => getMode(el.mode || "IMM"));
}

export const loader = {
    load,
};
