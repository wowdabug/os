const terminalEl = document.getElementById("terminal");

function out(text) {
    terminalEl.textContent += text;
}

export const terminal = {
    out
};
