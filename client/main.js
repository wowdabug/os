const terminal = document.getElementById("terminal");

function out(x) {
    terminal.textContent += x;
}

export const client = {
    out
};
