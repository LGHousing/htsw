#!/usr/bin/env node

import * as htsw from "htsw";

import fs from "node:fs";
import path from "node:path";
import { ansi } from "./ansi";
import { printDiagnostic } from "./diagnostics";

type ParseOutput = {
    sourceMap: htsw.SourceMap;
    diagnostics: htsw.Diagnostic[];
};

class NodeFileLoader {
    fileExists(filePath: string): boolean {
        return fs.existsSync(filePath);
    }

    readFile(filePath: string): string {
        return fs.readFileSync(filePath, "utf8");
    }

    getParentPath(base: string): string {
        return path.dirname(base);
    }

    resolvePath(base: string, other: string): string {
        return path.resolve(base, other);
    }
}

function main(): void {
    const args = process.argv.slice(2);
    const cmd = args[0];

    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        printCheckHelp();
        process.exit(0);
    }

    if (cmd === "check") {
        runCheck(args.slice(1));
        return;
    }

    console.error(`Unknown command '${cmd}'.`);
    printCheckHelp();
    process.exit(2);
}

function runCheck(args: string[]): void {
    if (args[0] === "--help" || args[0] === "-h") {
        printCheckHelp();
        process.exit(0);
    }

    const rawPath = args[0] ?? defaultImportJsonPath();
    const filePath = path.resolve(rawPath);
    const parse = parseFile(filePath);
    const diagnostics = parse.diagnostics;

    for (let i = 0; i < diagnostics.length; i++) {
        if (i !== 0) console.error("");
        const diagnostic = diagnostics[i];
        printDiagnostic(parse.sourceMap, diagnostic);
    }

    if (hasHardErrors(diagnostics)) {
        process.exit(1);
    }

    if (diagnostics.length === 0) {
        console.log(`${ansi("green", "OK")}: ${filePath}`);
    } else {
        console.log(
            `${ansi("green", "OK")}: ${filePath} (${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"})`,
        );
    }
    process.exit(0);
}

function parseFile(filePath: string): ParseOutput {
    const sourceMap = new htsw.SourceMap(new NodeFileLoader());

    if (isImportJsonPath(filePath)) {
        const parsed = htsw.parseImportablesResult(sourceMap, filePath);
        return {
            sourceMap,
            diagnostics: parsed.diagnostics,
        };
    }

    const parsed = htsw.parseActionsResult(sourceMap, filePath);
    return {
        sourceMap,
        diagnostics: parsed.diagnostics,
    };
}

function isImportJsonPath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return lower.endsWith("import.json") || lower.endsWith(".import.json");
}

function hasHardErrors(diagnostics: htsw.Diagnostic[]): boolean {
    return diagnostics.some((diagnostic) => {
        return diagnostic.level === "error" || diagnostic.level === "bug";
    });
}

function defaultImportJsonPath(): string {
    return path.resolve("import.json");
}

function printCheckHelp(): void {
    console.log("Usage: htsw check [path]");
    console.log("");
    console.log("Parses the given file and prints diagnostics.");
    console.log("Supported files: .htsl, import.json, *.import.json");
    console.log(`Default path: ${defaultImportJsonPath()}`);
}

main();
