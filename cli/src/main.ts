#!/usr/bin/env node

import * as htsw from "htsw";

import fs from "node:fs";
import path from "node:path";
import { ansi } from "./ansi";
import { printDiagnostic } from "./diagnostics";
import { Importable } from "htsw/types";
import { run } from "./runtime";

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

    if (cmd === "run") {
        runRun(args.slice(1));
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

    const filePath = args[0] ?? path.resolve("import.json");
    const sm = new htsw.SourceMap(new NodeFileLoader());
    const result = parseAndPrintDiagnostics(sm, filePath);

    if (hasErrors(result.diagnostics)) {
        process.exit(0);
    }

    console.log(ansi("green", "OK"));
}

function runRun(args: string[]): void {
    if (args[0] === "--help" || args[0] === "-h") {
        printRunHelp();
        process.exit(0);
    }

    const filePath = args[0] ?? path.resolve("import.json");
    const sm = new htsw.SourceMap(new NodeFileLoader());
    const result = parseAndPrintDiagnostics(sm, filePath);

    if (hasErrors(result.diagnostics)) {
        process.exit(0);
    }

    run(sm, result);
}

function parseAndPrintDiagnostics(sm: htsw.SourceMap, filePath: string): htsw.ParseResult<Importable[]> {
    const parsed = htsw.parseImportablesResult(sm, filePath);
    const diagnostics = parsed.diagnostics;

    for (let i = 0; i < diagnostics.length; i++) {
        if (i !== 0) console.error("");
        const diagnostic = diagnostics[i];
        printDiagnostic(sm, diagnostic);
    }

    return parsed;
}

function hasErrors(diagnostics: htsw.Diagnostic[]): boolean {
    return diagnostics.some((diagnostic) => {
        return diagnostic.level === "error" || diagnostic.level === "bug";
    });
}

function printCheckHelp(): void {
    console.log("Usage: htsw check [path]");
    console.log("");
    console.log("Parses the given file and prints diagnostics.");
    console.log("Supported files: import.json, *.import.json");
    console.log(`Default path: ${path.resolve("import.json") }`);
}

function printRunHelp(): void {
    console.log("Usage: htsw run [path]");
    console.log("");
    console.log("Parses the given file and runs function `htsw:main`");
    console.log("Supported files: import.json, *.import.json");
    console.log(`Default path: ${path.resolve("import.json")}`);
}

main();
