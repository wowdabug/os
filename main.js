import { lang } from "./lang.js";

async function main() {
    const response = await fetch("programs/program.txt");
    const program = await response.text();

    await lang.init();

    const start_compile = performance.now();
    const tokens = lang.compile(program);
    console.log("compile ms: " + (performance.now() - start_compile) + '\n')

    const start_run = performance.now();
    lang.run(tokens);
    console.log("run ms: " + (performance.now() - start_run) + '\n')
}

main();
