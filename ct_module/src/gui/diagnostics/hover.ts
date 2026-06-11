import type { Diagnostic, ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { formatDiagnostics, type FormattedTextBlock } from "../../diagnostics/format";
import { chatWidth } from "../../utils/helpers";
import type { Rect } from "../lib/layout";
import { hoverCardContentWidth, offerHoverCard } from "../lib/hoverCards";
import { getParsedResult } from "../state/parsed";

const diagnosticIds = new WeakMap<Diagnostic, number>();
let nextDiagnosticId = 1;
const cache = new WeakMap<ParseResult<Importable[]>, Map<string, FormattedTextBlock>>();

function diagnosticId(diagnostic: Diagnostic): number {
    let id = diagnosticIds.get(diagnostic);
    if (id === undefined) {
        id = nextDiagnosticId++;
        diagnosticIds.set(diagnostic, id);
    }
    return id;
}

export function hoverPath(path: string): string {
    const normalized = String(path).split("\\").join("/");
    const htswImports = normalized.lastIndexOf("/htsw/imports/");
    if (htswImports >= 0) return normalized.substring(htswImports + 1);
    const imports = normalized.lastIndexOf("/imports/");
    if (imports >= 0) return normalized.substring(imports + 1);
    return normalized;
}

function diagnosticsBlock(diagnostics: readonly Diagnostic[]): FormattedTextBlock | null {
    const parsed = getParsedResult();
    if (parsed === null || diagnostics.length === 0) return null;
    const ids: string[] = [];
    for (let i = 0; i < diagnostics.length; i++) ids.push(String(diagnosticId(diagnostics[i])));
    const width = hoverCardContentWidth();
    const key = ids.join(",") + "@" + width;
    let parsedCache = cache.get(parsed);
    if (parsedCache === undefined) {
        parsedCache = new Map();
        cache.set(parsed, parsedCache);
    }
    let content = parsedCache.get(key);
    if (content === undefined) {
        content = formatDiagnostics(
            parsed.gcx.sourceMap,
            diagnostics,
            width,
            hoverPath
        );
        parsedCache.set(key, content);
    }
    return content;
}

/**
 * One hover card per code-view row: the row's diagnostics (if any) followed
 * by any extra lines the active decorator supplies (e.g. the house's version
 * of an edited action). No-op when both are empty.
 */
export function offerLineHover(
    rect: Rect,
    diagnostics: readonly Diagnostic[] | undefined,
    extraLines: readonly string[] | undefined
): void {
    const diagBlock = diagnostics !== undefined ? diagnosticsBlock(diagnostics) : null;
    const extras = extraLines !== undefined && extraLines.length > 0 ? extraLines : null;
    if (diagBlock === null && extras === null) return;

    let lines: string[];
    let width: number;
    if (diagBlock !== null) {
        lines = extras === null ? diagBlock.lines : [...diagBlock.lines, "", ...extras];
        width = diagBlock.width;
    } else {
        lines = extras!.slice();
        width = 0;
    }
    if (extras !== null) {
        for (const line of extras) width = Math.max(width, chatWidth(line));
    }
    const content: FormattedTextBlock = { lines, width, height: lines.length };
    const key =
        (diagBlock !== null ? diagBlock.lines.length + ":" : "") +
        lines.join("\n") + "@" + width;
    offerHoverCard({ key, anchor: rect, content });
}
