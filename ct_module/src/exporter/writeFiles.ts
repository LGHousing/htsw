import type { Action } from "htsw/types";
import { hashSha256Hex } from "./hash";
import { generateFunctionHtsl } from "./htslGenerate";
import { joinPath, relativePath, writeText } from "./path";

type FunctionOutput = {
    name: string;
    repeatTicks?: number;
    actions?: Action[];
};

export type FunctionFileWriteResult = {
    name: string;
    absPath: string;
    relativePath: string;
    wroteStub: boolean;
};

function sanitizeSegment(value: string): string {
    const replaced = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[. ]+$/g, "");
    return replaced.length > 0 ? replaced : "unnamed_function";
}

function allocateNames(functions: FunctionOutput[]): Map<string, string> {
    const used = new Set<string>();
    const result = new Map<string, string>();

    for (const fn of functions) {
        const base = sanitizeSegment(fn.name);
        let candidate = base;
        if (used.has(candidate.toLowerCase())) {
            const suffix = hashSha256Hex(fn.name).slice(0, 8);
            candidate = `${base}_${suffix}`;
        }
        used.add(candidate.toLowerCase());
        result.set(fn.name, candidate);
    }
    return result;
}

function buildStubContent(name: string): string {
    return [
        `// Export pending for function ${JSON.stringify(name)}`,
        "// Function action scraping is not implemented in this runtime yet.",
        "",
    ].join("\n");
}

export function writeFunctionFiles(
    houseRoot: string,
    functions: FunctionOutput[]
): FunctionFileWriteResult[] {
    const functionDir = joinPath(houseRoot, "functions");
    const allocated = allocateNames(functions);
    const results: FunctionFileWriteResult[] = [];

    for (const fn of functions) {
        const fileName = `${allocated.get(fn.name)}.htsl`;
        const absPath = joinPath(functionDir, fileName);
        const content = fn.actions ? generateFunctionHtsl(fn.actions) : buildStubContent(fn.name);
        writeText(absPath, content, true);
        results.push({
            name: fn.name,
            absPath,
            relativePath: relativePath(houseRoot, absPath),
            wroteStub: fn.actions === undefined,
        });
    }

    return results;
}

