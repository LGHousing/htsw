// Profile a full parse of an import.json and emit a V8 CPU profile (flame graph).
//
//   1. npm run build            (in language/, produces dist/)
//   2. npx esbuild scripts/profileParse.mjs --bundle --platform=node \
//        --format=cjs --external:jsonc-parser --outfile=scripts/profileParse.cjs
//   3. node --cpu-prof --cpu-prof-name=parse.cpuprofile scripts/profileParse.cjs "<path/to/import.json>" [iterations]
//
// Drag the resulting parse.cpuprofile into https://www.speedscope.app (or
// Chrome DevTools → Performance → Load profile) for a flame graph. Each
// iteration clears the htsl cache so the lexer runs cold every time.
import * as htsw from "../dist/index.js";
import fs from "node:fs";
import path from "node:path";

class NodeFileLoader {
    fileExists(p) { return fs.existsSync(p); }
    readFile(p) { return fs.readFileSync(p, "utf8"); }
    getParentPath(b) { return path.dirname(b); }
    resolvePath(b, o) { return path.resolve(b, o); }
}

const importJson = process.argv[2];
const N = Number(process.argv[3] ?? 40);
if (!importJson) {
    console.error("usage: node profileParse.cjs <import.json> [iterations]");
    process.exit(1);
}

// warm up
htsw.parseImportablesResult(new htsw.SourceMap(new NodeFileLoader()), importJson);

const t = Date.now();
for (let i = 0; i < N; i++) {
    htsw.htsl.clearHtslCache();
    htsw.parseImportablesResult(new htsw.SourceMap(new NodeFileLoader()), importJson);
}
const ms = Date.now() - t;
console.error(`${N} cold parses in ${ms}ms — ${(ms / N).toFixed(1)}ms each`);
