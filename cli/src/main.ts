#!/usr/bin/env node

import * as htsw from "htsw";

import fs from "node:fs";
import path from "node:path";
import { ansi } from "./ansi";
import { printDiagnostic } from "./diagnostics";
import { Importable } from "htsw/types";
import { run } from "./runtime";
import { runAgents } from "./agents";
import { runUpgrade } from "./upgrade";

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
        printUsage();
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

    if (cmd === "agents") {
        runAgents(args.slice(1));
        return;
    }

    if (cmd === "upgrade") {
        runUpgrade(args.slice(1)).catch((err) => {
            console.error(String((err as Error)?.message ?? err));
            process.exit(1);
        });
        return;
    }

    console.error(`Unknown command '${cmd}'.`);
    printUsage();
    process.exit(2);
}

function printUsage(): void {
    console.log("Usage: htsw <command> [args]");
    console.log("");
    console.log("Commands:");
    console.log("  check [path]     Parse a file and print diagnostics.");
    console.log("  run [path]       Parse and run htsw:main.");
    console.log("  agents install   Install the agent guides into a project.");
    console.log("  upgrade          Update the htsw CLI in place.");
    console.log("");
    console.log("Run 'htsw <command> --help' for details.");
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
        process.exit(1);
    }

    console.log(ansi("green", "OK"));
}

function runRun(args: string[]): void {
    if (args[0] === "--help" || args[0] === "-h") {
        printRunHelp();
        process.exit(0);
    }

    let tickCount = 0;
    let filePath: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--ticks") {
            tickCount = parseInt(args[++i], 10);
            if (isNaN(tickCount) || tickCount < 0) {
                console.error("--ticks expects a non-negative integer");
                process.exit(2);
            }
        } else if (!filePath) {
            filePath = args[i];
        }
    }

    const resolvedPath = filePath ?? path.resolve("import.json");
    const sm = new htsw.SourceMap(new NodeFileLoader());
    const result = parseAndPrintDiagnostics(sm, resolvedPath);

    if (hasErrors(result.diagnostics)) {
        process.exit(1);
    }

    run(sm, result, tickCount);
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
    console.log("Usage: htsw run [path] [--ticks N]");
    console.log("");
    console.log("Parses the given file and runs function `htsw:main`");
    console.log("Supported files: import.json, *.import.json");
    console.log(`Default path: ${path.resolve("import.json")}`);
    console.log("");
    console.log("  --ticks N    Tick the runtime N times after running htsw:main.");
    console.log("               Drives pauses and repeating functions (default 0).");
}

main();
