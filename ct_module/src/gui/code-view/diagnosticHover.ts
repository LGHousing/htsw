import type { Diagnostic, ImportablesParseResult } from "htsw";

import { formatDiagnostics, type FormattedTextBlock, type LineSegment } from "../../diagnostics/format";
import {
    renderTextBlock,
    TextLayoutVStack,
    TextLayoutWrap,
} from "../../diagnostics/textLayout";
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
 * Decorator lines wrapped to the card, for the same reason diagnostic messages
 * are: an action's text can be far wider than the card, and the card has no
 * horizontal scroll to reach what falls outside it.
 */
function extraLinesBlock(
    extraLines: readonly string[] | undefined
): FormattedTextBlock | null {
    if (extraLines === undefined || extraLines.length === 0) return null;
    const width = hoverCardContentWidth();
    const stack = new TextLayoutVStack();
    for (let i = 0; i < extraLines.length; i++) {
        stack.add(new TextLayoutWrap(extraLines[i], width));
    }
    return renderTextBlock(stack);
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
    const extraBlock = extraLinesBlock(extraLines);
    if (diagBlock === null && extraBlock === null) return;

    let lines: string[];
    let segments: LineSegment[][];
    let width: number;
    if (diagBlock !== null && extraBlock !== null) {
        lines = [...diagBlock.lines, "", ...extraBlock.lines];
        segments = [...diagBlock.segments, [{ x: 0, text: "" }], ...extraBlock.segments];
        width = Math.max(diagBlock.width, extraBlock.width);
    } else {
        const only = diagBlock ?? extraBlock;
        // Narrowed by the early return above, but TypeScript cannot see it.
        if (only === null) return;
        lines = only.lines;
        segments = only.segments;
        width = only.width;
    }
    const content: FormattedTextBlock = { lines, segments, width, height: lines.length };
    const key =
        (diagBlock !== null ? diagBlock.lines.length + ":" : "") +
        lines.join("\n") + "@" + width;
    // Anchor at the cursor's x but the row's vertical extent, so the card
    // opens beside the pointer without covering the hovered line.
    offerHoverCard({ key, anchor: { x: mouseX, y: rect.y, w: 0, h: rect.h }, content });
}
