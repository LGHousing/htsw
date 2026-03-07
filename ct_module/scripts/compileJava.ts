import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const moduleRoot = resolve(process.cwd());
const source = join(moduleRoot, "java", "LongValue.java");
const outDir = join(moduleRoot, "dist");

mkdirSync(outDir, { recursive: true });
execFileSync("javac", ["--release", "8", "-d", outDir, source], {
    cwd: moduleRoot,
    stdio: "inherit",
});

console.log("Compiled LongValue.java");
