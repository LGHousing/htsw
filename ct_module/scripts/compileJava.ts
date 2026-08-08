import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const moduleRoot = resolve(process.cwd());
const javaDir = join(moduleRoot, "java");
const sources = readdirSync(javaDir)
    .filter((name) => name.endsWith(".java"))
    .map((name) => join(javaDir, name));
const outDir = join(moduleRoot, "dist");

mkdirSync(outDir, { recursive: true });
execFileSync("javac", ["--release", "8", "-d", outDir, ...sources], {
    cwd: moduleRoot,
    stdio: "inherit",
});

console.log(`Compiled ${sources.length} Java sources`);
