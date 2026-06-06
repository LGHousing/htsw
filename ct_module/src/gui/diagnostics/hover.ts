import type { Diagnostic, ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { formatDiagnostics, type FormattedTextBlock } from "../../diagnostics/format";
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

export function offerDiagnosticHover(rect: Rect, diagnostics: readonly Diagnostic[]): void {
    const parsed = getParsedResult();
    if (parsed === null || diagnostics.length === 0) return;
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
    offerHoverCard({ key, anchor: rect, content });
}
