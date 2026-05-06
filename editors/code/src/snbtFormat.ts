import * as vscode from "vscode";
import * as htsw from "htsw";

class StringFileLoader implements htsw.FileLoader {
    constructor(private readonly src: string) {}
    fileExists(): boolean { return true; }
    readFile(): string { return this.src; }
    getParentPath(): string { return ""; }
    resolvePath(): string { return ""; }
}

export type FormatResult =
    | { ok: true; output: string }
    | { ok: false; error: string };

export function formatSnbtText(src: string, indent = "    "): FormatResult {
    const trimmed = src.trim();
    if (trimmed.length === 0) {
        return { ok: false, error: "Empty SNBT input" };
    }

    const sourceMap = new htsw.SourceMap(new StringFileLoader(src));
    const gcx = new htsw.GlobalCtxt(sourceMap, "format.snbt");
    const tag = htsw.nbt.parseSnbt(gcx, "format.snbt");

    if (tag === undefined || gcx.isFailed()) {
        const first = gcx.diagnostics.find((d) => d.level === "error" || d.level === "bug");
        return { ok: false, error: first?.message ?? "Failed to parse SNBT" };
    }

    return { ok: true, output: htsw.nbt.printSnbt(tag, { pretty: true, indent }) };
}

export class SnbtFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
    ): vscode.TextEdit[] {
        if (document.languageId !== "snbt") return [];
        const indent = options.insertSpaces ? " ".repeat(Math.max(1, options.tabSize)) : "\t";
        const result = formatSnbtText(document.getText(), indent);
        if (!result.ok) return [];

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
        );
        return [vscode.TextEdit.replace(fullRange, result.output)];
    }
}

/**
 * Walk the source as a JSON-style string scanner and find the double-quoted
 * string whose contents (between the quotes, exclusive) contain `offset`.
 * Returns the open-quote and close-quote offsets if found.
 */
export function findEnclosingJsonString(
    src: string,
    offset: number,
): { openQuote: number; closeQuote: number } | undefined {
    let i = 0;
    while (i < src.length) {
        const ch = src.charCodeAt(i);
        // Skip line comments
        if (ch === 0x2f /* / */ && src.charCodeAt(i + 1) === 0x2f /* / */) {
            i += 2;
            while (i < src.length && src.charCodeAt(i) !== 0x0a /* \n */) i++;
            continue;
        }
        // Skip block comments
        if (ch === 0x2f && src.charCodeAt(i + 1) === 0x2a /* * */) {
            i += 2;
            while (i < src.length && !(src.charCodeAt(i) === 0x2a && src.charCodeAt(i + 1) === 0x2f)) i++;
            i += 2;
            continue;
        }
        if (ch !== 0x22 /* " */) {
            i++;
            continue;
        }
        const openQuote = i;
        i++;
        while (i < src.length) {
            const c = src.charCodeAt(i);
            if (c === 0x5c /* \ */) { i += 2; continue; }
            if (c === 0x22) break;
            i++;
        }
        if (i >= src.length) return undefined;
        const closeQuote = i;
        if (offset > openQuote && offset <= closeQuote) {
            return { openQuote, closeQuote };
        }
        i++;
    }
    return undefined;
}

/** Decode a JSON string literal (without the surrounding quotes). */
export function decodeJsonStringContent(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch !== "\\") { out += ch; continue; }
        const next = s.charAt(++i);
        if (next === "\"") out += "\"";
        else if (next === "\\") out += "\\";
        else if (next === "/") out += "/";
        else if (next === "n") out += "\n";
        else if (next === "r") out += "\r";
        else if (next === "t") out += "\t";
        else if (next === "b") out += "\b";
        else if (next === "f") out += "\f";
        else if (next === "u") {
            const hex = s.slice(i + 1, i + 5);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
        } else {
            out += next;
        }
    }
    return out;
}

/** Encode a string back into a JSON string literal (with surrounding quotes). */
export function encodeJsonString(s: string): string {
    return JSON.stringify(s);
}
