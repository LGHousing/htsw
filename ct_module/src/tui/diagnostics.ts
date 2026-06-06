import type { Diagnostic, SourceMap } from "htsw";
import { formatDiagnostic, formatDiagnostics } from "../diagnostics/format";

export function printDiagnostics(sm: SourceMap, diags: Diagnostic[]) {
    const block = formatDiagnostics(sm, diags, ChatLib.getChatWidth());
    for (let i = 0; i < block.lines.length; i++) ChatLib.chat(block.lines[i]);
}

export function printDiagnostic(sm: SourceMap, diag: Diagnostic) {
    const block = formatDiagnostic(sm, diag, ChatLib.getChatWidth());
    for (let i = 0; i < block.lines.length; i++) ChatLib.chat(block.lines[i]);
}
