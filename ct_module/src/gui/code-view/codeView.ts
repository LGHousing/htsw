/// <reference types="../../../CTAutocomplete" />

import { Container, Scroll, Text } from "../lib/components";
import type { Element } from "../lib/layout";
import {
    clearUserScrollOverride,
    getScrollState,
    SCROLLBAR_WIDTH,
    setScrollOffset,
} from "../lib/layout";
import { extract, type Extractable } from "../lib/extractable";
import { COLOR_TEXT_FAINT } from "../lib/theme";
import { linesForFile } from "./lineModel";
import {
    buildLineRows,
    FOCUS_GUTTER_W,
    gutterWidthForLines,
    LINE_H,
    STATE_GUTTER_W,
} from "./lineRow";
import type { LineDecorations, LineDecorator, RenderableLine, TokenSpan } from "./types";
import { wrapTokensIntoVisualRows } from "./wrap";

export type CodeViewProps = {
    source?: Extractable<string | null>;
    lines?: Extractable<readonly RenderableLine[] | null>;
    scrollId: string;
    /**
     * Reactive line decorator (re-extracted each frame).
     * NOTE: property key is `lineDecorator`, NOT `decorator`. CT 2.2.1's Rhino fork
     * treats the bare identifier `decorator` as a contextual keyword (see docs/BUGS.md).
     * Babel transpiles an inline arrow `decorator: () => ...` into `function decorator() {...}`
     * which NPEs at parse time. Naming the prop `lineDecorator` dodges the trap.
     */
    lineDecorator: Extractable<LineDecorator>;
    autoFollow?: boolean;

    scrollLocked?: Extractable<boolean>;
    emptyMessage?: string;
};

const FOLLOW_THROTTLE_MS = 80;

type FollowMeta = {
    lastFollowAt: number;
    focusedId: string | null;
    focusedSeenAt: number;
    lastResolvedIdx: number;
    warnedMissingIds: { [id: string]: true };
};

const followStates: { [id: string]: FollowMeta } = {};

type DecoratedLine = {
    line: RenderableLine;
    decorations: LineDecorations;
};

function getFollowMeta(scrollId: string): FollowMeta {
    let m = followStates[scrollId];
    if (!m) {
        m = {
            lastFollowAt: 0,
            focusedId: null,
            focusedSeenAt: 0,
            lastResolvedIdx: -1,
            warnedMissingIds: {},
        };
        followStates[scrollId] = m;
    }
    return m;
}

export function CodeView(props: CodeViewProps): Element {
    return Scroll({
        id: props.scrollId,
        style: { height: { kind: "grow" }, gap: 0 },
        locked: props.scrollLocked,
        children: () => {
            const lineDecorator = extract(props.lineDecorator);
            let lines: readonly RenderableLine[] | null = null;
            if (props.lines !== undefined) {
                const explicit = extract(props.lines);
                if (explicit !== null && explicit.length > 0) {
                    lines = explicit;
                }
            }
            if (lines === null && props.source !== undefined) {
                const path = extract(props.source);
                if (path !== null) {
                    lines = linesForFile(path);
                }
            }
            if (lines === null || lines.length === 0) {
                return buildEmptyMessageRows(
                    props.emptyMessage ?? "(no file)",
                    bodyWidthForScroll(props.scrollId, 0, false, false)
                );
            }
            const decorated: DecoratedLine[] = [];
            let showStatusGutters = false;
            let maxLineNum = 1;
            for (let i = 0; i < lines.length; i++) {
                const dec = lineDecorator.decorateLine(lines[i]);
                if (lines[i].lineNum > maxLineNum) maxLineNum = lines[i].lineNum;
                if (hasStatusGutterContent(dec)) showStatusGutters = true;
                if (dec.extraLinesBefore !== undefined) {
                    for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                        const extra = dec.extraLinesBefore[j];
                        if (extra.line.lineNum > maxLineNum) {
                            maxLineNum = extra.line.lineNum;
                        }
                        if (hasStatusGutterContent(extra.decorations)) {
                            showStatusGutters = true;
                        }
                    }
                }
                decorated.push({ line: lines[i], decorations: dec });
            }
            const gutterW = gutterWidthForLines(maxLineNum);
            const lineNumDigits = digitsOf(maxLineNum);
            const bodyMaxWidth = bodyWidthForScroll(
                props.scrollId,
                gutterW,
                showStatusGutters,
                showStatusGutters
            );

            // ── Virtualization pre-pass ──────────────────────────────
            // Cheap O(decorated) pass: count visual rows per entry (each
            // line can wrap into multiple rows) and build the
            // lineIdToIndex map needed by autoFollow. Avoids constructing
            // any actual Element trees for off-screen lines below.
            const lineIdToIndex: { [id: string]: number } = {};
            const entryRowStart: number[] = new Array(decorated.length);
            const entryRowEnd: number[] = new Array(decorated.length);
            let totalRows = 0;
            for (let i = 0; i < decorated.length; i++) {
                const line = decorated[i].line;
                const dec = decorated[i].decorations;
                entryRowStart[i] = totalRows;
                if (dec.extraLinesBefore !== undefined) {
                    for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                        const extra = dec.extraLinesBefore[j];
                        if (lineIdToIndex[extra.line.id] === undefined) {
                            lineIdToIndex[extra.line.id] = totalRows;
                        }
                        totalRows += wrapRowCount(extra.line, bodyMaxWidth);
                    }
                }
                if (lineIdToIndex[line.id] === undefined) {
                    lineIdToIndex[line.id] = totalRows;
                }
                totalRows += wrapRowCount(line, bodyMaxWidth);
                entryRowEnd[i] = totalRows;
            }

            // ── Visibility window ────────────────────────────────────
            const scrollState = getScrollState(props.scrollId);
            const offset = scrollState.offset;
            const viewportH =
                scrollState.viewportRect.h > 0
                    ? scrollState.viewportRect.h
                    : 0;
            const BUFFER_ROWS = 8;
            const haveViewport = viewportH > 0;
            // Without a viewport (first render before measurement) keep
            // the old "render everything" behavior so initial layout
            // measurement still works.
            const firstVisibleRow = haveViewport
                ? Math.max(0, Math.floor(offset / LINE_H) - BUFFER_ROWS)
                : 0;
            const lastVisibleRow = haveViewport
                ? Math.min(totalRows, Math.ceil((offset + viewportH) / LINE_H) + BUFFER_ROWS)
                : totalRows;

            // ── Build only visible entries ───────────────────────────
            const out: Element[] = [];
            let skippedBeforeRows = 0;
            let skippedAfterRows = 0;
            for (let i = 0; i < decorated.length; i++) {
                const start = entryRowStart[i];
                const end = entryRowEnd[i];
                if (end <= firstVisibleRow) {
                    skippedBeforeRows = end;
                    continue;
                }
                if (start >= lastVisibleRow) {
                    skippedAfterRows = totalRows - start;
                    break;
                }
                const line = decorated[i].line;
                const dec = decorated[i].decorations;
                if (dec.extraLinesBefore !== undefined) {
                    for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                        const extra = dec.extraLinesBefore[j];
                        const rows = buildLineRows(extra.line, extra.decorations, {
                            gutterWidth: gutterW,
                            lineNumDigits,
                            bodyMaxWidth,
                            showFocusGutter: showStatusGutters,
                            showStateGutter: showStatusGutters,
                        });
                        for (let k = 0; k < rows.length; k++) out.push(rows[k]);
                    }
                }
                const rows = buildLineRows(line, dec, {
                    gutterWidth: gutterW,
                    lineNumDigits,
                    bodyMaxWidth,
                    showFocusGutter: showStatusGutters,
                    showStateGutter: showStatusGutters,
                });
                for (let k = 0; k < rows.length; k++) out.push(rows[k]);
            }

            if (skippedBeforeRows > 0) {
                out.unshift(spacerRows(skippedBeforeRows));
            }
            if (skippedAfterRows > 0) {
                out.push(spacerRows(skippedAfterRows));
            }

            if (props.autoFollow === true) {
                applyAutoFollow(
                    props.scrollId,
                    lineDecorator,
                    lineIdToIndex
                );
            }
            return out;
        },
    });
}

/**
 * Cache of `wrapTokensIntoVisualRows`'s row count per RenderableLine.
 * The wrap result depends only on `line.tokens` (immutable per line)
 * and `bodyMaxWidth` (changes on resize). The virtualization pre-pass
 * calls this for every line every frame; without a cache that's the
 * dominant scroll-frame cost on long files.
 */
const wrapRowCountCache = new WeakMap<
    RenderableLine,
    { width: number; count: number }
>();

function wrapRowCount(line: RenderableLine, bodyMaxWidth: number): number {
    const cached = wrapRowCountCache.get(line);
    if (cached !== undefined && cached.width === bodyMaxWidth) {
        return cached.count;
    }
    const wrapped = wrapTokensIntoVisualRows(line.tokens, bodyMaxWidth);
    wrapRowCountCache.set(line, { width: bodyMaxWidth, count: wrapped.length });
    return wrapped.length;
}

/**
 * Empty container that reserves `rowCount * LINE_H` pixels of vertical
 * space. Used by the virtualization pass to preserve total content
 * height (and therefore scrollbar accuracy) when off-screen lines are
 * skipped from the actual Element tree.
 */
function spacerRows(rowCount: number): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: rowCount * LINE_H },
        },
        children: [],
    });
}

function digitsOf(n: number): number {
    if (n <= 0) return 1;
    let d = 0;
    let x = n;
    while (x > 0) {
        d++;
        x = Math.floor(x / 10);
    }
    return d;
}

function hasStatusGutterContent(dec: LineDecorations): boolean {
    return (
        dec.state !== undefined
        || dec.isFocused === true
        || dec.cursorColumnBackground !== undefined
    );
}

function bodyWidthForScroll(
    scrollId: string,
    gutterW: number,
    showFocusGutter: boolean,
    showStateGutter: boolean
): number {
    const state = getScrollState(scrollId);
    const viewportW = state.viewportRect.w > 0 ? state.viewportRect.w : 240;
    let fixed = gutterW;
    let childCount = 2;
    if (showFocusGutter) {
        fixed += FOCUS_GUTTER_W;
        childCount++;
    }
    if (showStateGutter) {
        fixed += STATE_GUTTER_W;
        childCount++;
    }
    const contentW = Math.max(0, viewportW - SCROLLBAR_WIDTH);
    const rowInnerW = Math.max(0, contentW - 8);
    return Math.max(1, rowInnerW - fixed - (childCount - 1) * 4);
}

function buildEmptyMessageRows(message: string, bodyMaxWidth: number): Element[] {
    const token: TokenSpan = { text: message, color: COLOR_TEXT_FAINT };
    const rows = wrapTokensIntoVisualRows([token], Math.max(1, bodyMaxWidth - 12));
    const children: Element[] = [];
    for (let i = 0; i < rows.length; i++) {
        let text = "";
        for (let j = 0; j < rows[i].length; j++) text += rows[i][j].text;
        children.push(Text({ text, color: COLOR_TEXT_FAINT }));
    }
    return [
        Container({
            style: { direction: "col", padding: 6, gap: 0 },
            children,
        }),
    ];
}

function applyAutoFollow(
    scrollId: string,
    lineDecorator: LineDecorator,
    lineIdToIndex: { [id: string]: number }
): void {
    const focusedId = lineDecorator.focusedLineId();
    if (focusedId === null) return;
    const meta = getFollowMeta(scrollId);
    const state = getScrollState(scrollId);
    const now = Date.now();
    if (meta.focusedId !== focusedId) {
        meta.focusedId = focusedId;
        meta.focusedSeenAt = now;
        meta.lastResolvedIdx = -1;
    }

    const idx = lineIdToIndex[focusedId];
    if (idx === undefined) {
        if (meta.warnedMissingIds[focusedId] !== true) {
            meta.warnedMissingIds[focusedId] = true;
            console.warn(
                `[CodeView] autoFollow: focused line id "${focusedId}" not present in ${scrollId}`
            );
        }
        return;
    }

    // The user took manual control of this scroll (wheel/drag). Don't
    // fight them — the jump-back pip in the corner can resume.
    if (state.userOverridden) return;

    if (idx === meta.lastResolvedIdx && now - meta.lastFollowAt < FOLLOW_THROTTLE_MS) {
        return;
    }
    meta.lastResolvedIdx = idx;

    const viewportH = state.viewportRect.h;
    if (viewportH <= 0) return;
    const focusedY = idx * LINE_H;
    const target = Math.max(0, focusedY - Math.floor(viewportH / 2));
    setScrollOffset(scrollId, target);
    meta.lastFollowAt = now;
}

/**
 * Snaps the scroll back to the currently focused line and re-enables
 * autoscroll. Called from the "jump to current" pip.
 */
export function jumpToFocusedLine(scrollId: string): void {
    const meta = getFollowMeta(scrollId);
    clearUserScrollOverride(scrollId);
    // Force a re-resolve next frame so the next applyAutoFollow scrolls
    // immediately rather than skipping due to lastResolvedIdx match.
    meta.lastResolvedIdx = -1;
    meta.lastFollowAt = 0;
}
