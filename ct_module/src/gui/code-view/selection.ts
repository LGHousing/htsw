/// <reference types="../../../CTAutocomplete" />

import { javaType } from "../lib/java";
import { chatWidth } from "../../utils/helpers";
import { joinTokenText } from "./wrap";
import type { RenderableLine, TokenSpan } from "./lineTypes";
import { markGuiDirty } from "../lib/dirty";

// Read-only text selection for the code view. Selection is anchored to a logical
// line `id` + a source column (an index into that line's joined token text), so
// it survives virtualization (off-screen lines aren't in the element tree) and
// word-wrap (a click on a wrapped visual row maps back to the source column via
// each token's `srcStart`).
//
// There is one active selection at a time across both code views; a view is
// identified by its `scrollId`. `identity` is the file path (or a live-view
// sentinel) the selection was made against — when a view publishes a different
// identity (the user switched files), the stale selection is dropped so it can't
// mis-highlight or mis-copy a same-line-id collision in another file.

const MouseClass = javaType("org.lwjgl.input.Mouse");

type Selection = {
    scrollId: string;
    identity: string;
    anchorId: string;
    anchorCol: number;
    focusId: string;
    focusCol: number;
    dragging: boolean;
};

type Published = {
    identity: string;
    lines: readonly RenderableLine[];
};

let active: Selection | null = null;
const published: { [scrollId: string]: Published } = {};

/**
 * Called by the code view each frame with the lines it rendered, in display
 * order. Backs copy/select-all and clears a stale selection when the view's
 * file changed under it.
 */
export function publishCodeView(
    scrollId: string,
    identity: string,
    lines: readonly RenderableLine[]
): void {
    if (active !== null && active.scrollId === scrollId && active.identity !== identity) {
        active = null;
        markGuiDirty();
    }
    published[scrollId] = { identity, lines };
}

export function getViewSelection(
    scrollId: string,
    identity: string
): { anchorId: string; anchorCol: number; focusId: string; focusCol: number } | null {
    if (active === null || active.scrollId !== scrollId || active.identity !== identity) {
        return null;
    }
    return {
        anchorId: active.anchorId,
        anchorCol: active.anchorCol,
        focusId: active.focusId,
        focusCol: active.focusCol,
    };
}

export function beginSelection(scrollId: string, lineId: string, col: number): void {
    const pub = published[scrollId];
    active = {
        scrollId,
        identity: pub === undefined ? "" : pub.identity,
        anchorId: lineId,
        anchorCol: col,
        focusId: lineId,
        focusCol: col,
        dragging: false,
    };
    markGuiDirty();
}

/**
 * Extend the active selection's focus to a position on `lineId`, but only while
 * the left mouse button is held — the row's `onHover` fires every frame, so this
 * doubles as drag-release detection (mirrors `tabDrag`).
 */
export function onRowDrag(
    scrollId: string,
    lineId: string,
    tokens: readonly TokenSpan[],
    localX: number
): void {
    if (active === null || active.scrollId !== scrollId) return;
    if (!MouseClass.isButtonDown(0)) {
        if (active.dragging) {
            active.dragging = false;
            markGuiDirty();
        }
        return;
    }
    const focusCol = sourceColAtX(tokens, localX);
    const changed =
        active.focusId !== lineId || active.focusCol !== focusCol || !active.dragging;
    active.focusId = lineId;
    active.focusCol = focusCol;
    active.dragging = true;
    if (changed) markGuiDirty();
}

export function selectWord(scrollId: string, lineId: string, col: number): void {
    const pub = published[scrollId];
    const line = pub === undefined ? null : findLine(pub.lines, lineId);
    if (pub === null || pub === undefined || line === null) {
        beginSelection(scrollId, lineId, col);
        return;
    }
    const text = joinTokenText(line.tokens);
    const bounds = wordBounds(text, col);
    active = {
        scrollId,
        identity: pub.identity,
        anchorId: lineId,
        anchorCol: bounds[0],
        focusId: lineId,
        focusCol: bounds[1],
        dragging: false,
    };
    markGuiDirty();
}

export function selectAllActive(): void {
    if (active === null) return;
    const pub = published[active.scrollId];
    if (pub === undefined || pub.lines.length === 0) return;
    const first = pub.lines[0];
    const last = pub.lines[pub.lines.length - 1];
    active = {
        scrollId: active.scrollId,
        identity: pub.identity,
        anchorId: first.id,
        anchorCol: 0,
        focusId: last.id,
        focusCol: joinTokenText(last.tokens).length,
        dragging: false,
    };
    markGuiDirty();
}

export function clearSelection(): void {
    if (active === null) return;
    active = null;
    markGuiDirty();
}

export function hasActiveSelection(): boolean {
    if (active === null) return false;
    return !(active.anchorId === active.focusId && active.anchorCol === active.focusCol);
}

export function copyActiveSelection(): void {
    if (active === null) return;
    const pub = published[active.scrollId];
    if (pub === undefined || pub.identity !== active.identity) return;
    const lines = pub.lines;

    const ordinal: { [id: string]: number } = {};
    for (let i = 0; i < lines.length; i++) {
        if (ordinal[lines[i].id] === undefined) ordinal[lines[i].id] = i;
    }
    const aOrd = ordinal[active.anchorId];
    const fOrd = ordinal[active.focusId];
    if (aOrd === undefined || fOrd === undefined) return;

    let start = { ord: aOrd, col: active.anchorCol };
    let end = { ord: fOrd, col: active.focusCol };
    if (end.ord < start.ord || (end.ord === start.ord && end.col < start.col)) {
        const swap = start;
        start = end;
        end = swap;
    }

    const lineText = (i: number): string => joinTokenText(lines[i].tokens);
    let text: string;
    if (start.ord === end.ord) {
        text = lineText(start.ord).substring(start.col, end.col);
    } else {
        const parts: string[] = [lineText(start.ord).substring(start.col)];
        for (let o = start.ord + 1; o < end.ord; o++) parts.push(lineText(o));
        parts.push(lineText(end.ord).substring(0, end.col));
        text = parts.join("\n");
    }
    if (text.length === 0) return;

    if (setClipboard(text)) {
        const n = end.ord - start.ord + 1;
        ChatLib.chat(`&7[htsw] copied ${n} line${n === 1 ? "" : "s"} (${text.length} chars)`);
    }
}

/**
 * Maps a body-local x (pixels from the start of the text body) to a source
 * column on the given visual row, snapping to the nearest character boundary.
 */
export function sourceColAtX(tokens: readonly TokenSpan[], x: number): number {
    if (tokens.length === 0) return 0;
    if (x <= 0) return tokens[0].srcStart ?? 0;
    let cursor = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const w = chatWidth(t.text, false);
        if (x < cursor + w) {
            const base = t.srcStart ?? 0;
            let cx = cursor;
            for (let j = 0; j < t.text.length; j++) {
                const cw = chatWidth(t.text.charAt(j), false);
                if (x < cx + cw / 2) return base + j;
                cx += cw;
            }
            return base + t.text.length;
        }
        cursor += w;
    }
    const last = tokens[tokens.length - 1];
    return (last.srcStart ?? 0) + last.text.length;
}

function findLine(lines: readonly RenderableLine[], id: string): RenderableLine | null {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].id === id) return lines[i];
    }
    return null;
}

function isWordChar(c: string): boolean {
    return /[A-Za-z0-9_]/.test(c);
}

function wordBounds(text: string, col: number): [number, number] {
    let s = Math.min(Math.max(col, 0), text.length);
    if (s < text.length && isWordChar(text.charAt(s))) {
        let e = s;
        while (s > 0 && isWordChar(text.charAt(s - 1))) s--;
        while (e < text.length && isWordChar(text.charAt(e))) e++;
        return [s, e];
    }
    if (s > 0 && isWordChar(text.charAt(s - 1))) {
        let start = s;
        while (start > 0 && isWordChar(text.charAt(start - 1))) start--;
        return [start, s];
    }
    return [s, Math.min(s + 1, text.length)];
}

function setClipboard(text: string): boolean {
    try {
        const Toolkit = javaType("java.awt.Toolkit");
        const StringSelection = javaType("java.awt.datatransfer.StringSelection");
        const selection = new StringSelection(String(text));
        Toolkit.getDefaultToolkit().getSystemClipboard().setContents(selection, null);
        return true;
    } catch (e) {
        try {
            ChatLib.chat(`&c[htsw] clipboard failed: ${e}`);
        } catch (_e) {
            // ignore
        }
        return false;
    }
}
