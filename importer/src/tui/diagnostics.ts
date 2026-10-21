import type { Diagnostic, SourceMap } from "htsw";
import { formatDiagnostic, formatDiagnostics } from "../diagnostics/format";
import { platform } from "../platform";

export function printDiagnostics(sm: SourceMap, diags: Diagnostic[]) {
    const block = formatDiagnostics(sm, diags, platform().chatBoxWidth());
    for (let i = 0; i < block.lines.length; i++) platform().chat(block.lines[i]);
}

export function printDiagnostic(sm: SourceMap, diag: Diagnostic) {
    const block = formatDiagnostic(sm, diag, platform().chatBoxWidth());
    for (let i = 0; i < block.lines.length; i++) platform().chat(block.lines[i]);
}
