const terminalEl = document.getElementById("terminal");

const decoder = new TextDecoder();

let buffer = '';

// implement buffer / flushing
function outU8(x) {
    buffer += x;
}

function outI32(x) {
    buffer += x;
}

function outF32(x) {
    buffer += x;
}

function outChar(c) {
    buffer += String.fromCharCode(c);
}

function outStr(ba) {
    buffer += decoder.decode(ba);
}

function flush() {
    terminalEl.textContent += buffer;
}

export const terminal = {
    outU8,
    outI32,
    outF32,
    outChar,
    outStr,
    flush
};
