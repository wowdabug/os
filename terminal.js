const terminalEl = document.getElementById("terminal");

function out(x) {
    terminalEl.textContent += x;
}

export const terminal = {
    out
};
