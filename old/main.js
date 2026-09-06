import { lang } from "./lang/main.js";

async function main() {
    const response = await fetch("lang/examples/loop.txt");
    const text = await response.text();

    await lang.load();
    const program = lang.compile(text);
    lang.run(program);
}

main();
