import { lang } from "./lang.js";

function compile() {
    const start = performance.now();
    const tokens = lang.compile(program);
    const end = performance.now();
    const elapsed = end - start;
    console.log("run ms: " + elapsed + '\n')
}

function run() {
    const start = performance.now();
    lang.run(tokens);
    const end = performance.now();
    const elapsed = end - start;
    console.log("run ms: " + elapsed + '\n')
}

function execute(program) {
    const start_compile = performance.now();
    const tokens = lang.compile(program);
    console.log("compile seconds: " + (performance.now() - start_compile) / 1000 + '\n')

    const start_run = performance.now();
    lang.run(tokens);
    console.log("run seconds: " + (performance.now() - start_run) / 1000 + '\n')
}

async function main() {
    const response = await fetch("program.txt");
    const program = await response.text();

    execute(program);
}

main();
