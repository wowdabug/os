import { asm } from "./asm/main.js";

async function main() {
    const response = await fetch("asm/examples/strings.txt")
    const text = await response.text();

    const program = asm.compile(text);
    console.log(program);
    asm.run(program);
}

main();
