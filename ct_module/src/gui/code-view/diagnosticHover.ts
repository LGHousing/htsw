import type { Diagnostic, ImportablesParseResult } from "htsw";

import { formatDiagnostics, type FormattedTextBlock, type LineSegment } from "../../diagnostics/format";
import { chatWidth } from "../../utils/helpers";
import type { Rect } from "../lib/layout";
import { hoverCardContentWidth, offerHoverCard } from "../lib/hoverCards";

const diagnosticIds = new WeakMap<Diagnostic, number>();
let nextDiagnosticId = 1;
const cache = new WeakMap<ImportablesParseResult, Map<string, FormattedTextBlock>>();

function diagnosticId(diagnostic: Diagnostic): number {
    let id = diagnosticIds.get(diagnostic);
    if (id === undefined) {
        id = nextDiagnosticId++;
        diagnosticIds.set(diagnostic, id);
    }
    return id;
}

export function hoverPath(path: string): string {
    const normalized = path.split("\\").join("/");
    const htswProjects = normalized.lastIndexOf("/htsw/projects/");
    if (htswProjects >= 0) return normalized.substring(htswProjects + 1);
    const projects = normalized.lastIndexOf("/projects/");
    if (projects >= 0) return normalized.substring(projects + 1);
    return normalized;
}

function diagnosticsBlock(
    diagnostics: readonly Diagnostic[],
    parsed: ImportablesParseResult | undefined
): FormattedTextBlock | null {
    if (parsed === undefined || diagnostics.length === 0) return null;
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
    mouseX: number,
    diagnostics: readonly Diagnostic[] | undefined,
    diagnosticParse: ImportablesParseResult | undefined,
    extraLines: readonly string[] | undefined
): void {
    const diagBlock =
        diagnostics !== undefined ? diagnosticsBlock(diagnostics, diagnosticParse) : null;
    const extras = extraLines !== undefined && extraLines.length > 0 ? extraLines : null;
    if (diagBlock === null && extras === null) return;

    let lines: string[];
    let segments: LineSegment[][];
    let width: number;
    if (diagBlock !== null) {
        if (extras === null) {
            lines = diagBlock.lines;
            segments = diagBlock.segments;
        } else {
            lines = [...diagBlock.lines, "", ...extras];
            segments = [
                ...diagBlock.segments,
                [{ x: 0, text: "" }],
                ...extras.map((line) => [{ x: 0, text: line }]),
            ];
        }
        width = diagBlock.width;
    } else {
        lines = extras === null ? [] : extras.slice();
        segments = extras === null ? [] : extras.map((line) => [{ x: 0, text: line }]);
        width = 0;
    }
    if (extras !== null) {
        for (const line of extras) width = Math.max(width, chatWidth(line));
    }
    const content: FormattedTextBlock = { lines, segments, width, height: lines.length };
    const key =
        (diagBlock !== null ? diagBlock.lines.length + ":" : "") +
        lines.join("\n") + "@" + width;
    // Anchor at the cursor's x but the row's vertical extent, so the card
    // opens beside the pointer without covering the hovered line.
    offerHoverCard({ key, anchor: { x: mouseX, y: rect.y, w: 0, h: rect.h }, content });
}
