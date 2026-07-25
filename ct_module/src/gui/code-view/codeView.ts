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
    effectiveBodyWidth,
    FOCUS_GUTTER_W,
    gutterWidthForLines,
    LINE_H,
    STATE_GUTTER_W,
} from "./lineRow";
import type {
    LineDecorations,
    LineDecorator,
    LineSelection,
    RenderableLine,
    TokenSpan,
} from "./lineTypes";
import { joinTokenText, wrapTokensIntoVisualRows } from "./wrap";
import { getViewSelection, publishCodeView } from "./selection";
import { recordPhase } from "../lib/framePerf";
import { markGuiDirty } from "../lib/dirty";

export type CodeViewProps = {
    source?: Extractable<string | null>;
    sourceImportJsonPath?: Extractable<string | null>;
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
    emptyMessage?: Extractable<string>;
    onOpenPath?: (path: string, options: { activate: boolean }) => void;
};

const FOLLOW_THROTTLE_MS = 80;

type FollowMeta = {
    lastFollowAt: number;
    focusedId: string | null;
    focusedSeenAt: number;
    lastResolvedIdx: number;
};

const followStates: { [id: string]: FollowMeta | undefined } = {};

type DecoratedLine = {
    line: RenderableLine;
    decorations: LineDecorations;
};

/**
 * The whole-file decoration + row-layout pass: every line's decorations,
 * wrap-derived row offsets, and the id lookup tables. Everything in here is
 * O(total lines) to produce but independent of the scroll offset, so it is
 * cached across frames (see `modelCache`) and eased scrolling only pays for
 * slicing the visible window out of it.
 */
type LineModel = {
    decorated: DecoratedLine[];
    entryRowStart: number[];
    entryRowEnd: number[];
    totalRows: number;
    lineIdToIndex: { [id: string]: number | undefined };
    orderedLines: RenderableLine[];
    idToOrdinal: { [id: string]: number | undefined };
    showFocusGutter: boolean;
    showStateGutter: boolean;
    gutterW: number;
    lineNumDigits: number;
    bodyMaxWidth: number;
};

type ModelCacheEntry = {
    lines: readonly RenderableLine[];
    decoratorKey: string;
    viewportW: number;
    model: LineModel;
};

const modelCache: { [scrollId: string]: ModelCacheEntry | undefined } = {};

function buildLineModel(
    scrollId: string,
    lines: readonly RenderableLine[],
    lineDecorator: LineDecorator
): LineModel {
    const decorated: DecoratedLine[] = [];
    const reserved = lineDecorator.gutterVisibility?.();
    let showFocusGutter = reserved?.focus === true;
    let showStateGutter = reserved?.state === true;
    let maxLineNum = 1;
    const noteGutterContent = (dec: LineDecorations): void => {
        if (hasFocusGutterContent(dec)) showFocusGutter = true;
        if (hasStateGutterContent(dec)) showStateGutter = true;
    };
    for (let i = 0; i < lines.length; i++) {
        const dec = lineDecorator.decorateLine(lines[i]);
        if (lines[i].lineNum > maxLineNum) maxLineNum = lines[i].lineNum;
        noteGutterContent(dec);
        if (dec.extraLinesBefore !== undefined) {
            for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                const extra = dec.extraLinesBefore[j];
                if (extra.line.lineNum > maxLineNum) {
                    maxLineNum = extra.line.lineNum;
                }
                noteGutterContent(extra.decorations);
            }
        }
        decorated.push({ line: lines[i], decorations: dec });
    }
    const endLines = lineDecorator.extraLinesAtEnd?.() ?? [];
    for (let i = 0; i < endLines.length; i++) {
        const extra = endLines[i];
        noteGutterContent(extra.decorations);
        decorated.push(extra);
    }
    const gutterW = gutterWidthForLines(maxLineNum);
    const lineNumDigits = digitsOf(maxLineNum);
    const bodyMaxWidth = bodyWidthForScroll(
        scrollId,
        gutterW,
        showFocusGutter,
        showStateGutter
    );

    // Count visual rows per entry (each line can wrap into multiple rows)
    // and build the lineIdToIndex map needed by autoFollow — without
    // constructing Element trees for anything.
    const lineIdToIndex: { [id: string]: number | undefined } = {};
    const entryRowStart = new Array<number>(decorated.length);
    const entryRowEnd = new Array<number>(decorated.length);
    const orderedLines: RenderableLine[] = [];
    const idToOrdinal: { [id: string]: number | undefined } = {};
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
                if (idToOrdinal[extra.line.id] === undefined) {
                    idToOrdinal[extra.line.id] = orderedLines.length;
                }
                orderedLines.push(extra.line);
                totalRows += wrapRowCount(extra.line, bodyMaxWidth, extra.decorations);
            }
        }
        if (lineIdToIndex[line.id] === undefined) {
            lineIdToIndex[line.id] = totalRows;
        }
        if (idToOrdinal[line.id] === undefined) {
            idToOrdinal[line.id] = orderedLines.length;
        }
        orderedLines.push(line);
        totalRows += wrapRowCount(line, bodyMaxWidth, dec);
        entryRowEnd[i] = totalRows;
    }

    return {
        decorated,
        entryRowStart,
        entryRowEnd,
        totalRows,
        lineIdToIndex,
        orderedLines,
        idToOrdinal,
        showFocusGutter,
        showStateGutter,
        gutterW,
        lineNumDigits,
        bodyMaxWidth,
    };
}

/**
 * Reuse of built row Elements across frames. During a scroll almost the
 * whole visible window repeats from the last frame, and `buildLineRows`
 * re-wraps tokens and allocates a container tree per line — the dominant
 * remaining rebuild cost once the LineModel itself is cached. Everything a
 * row's Elements close over is in the key: the decorations object (stable
 * while the LineModel cache holds, replaced when it rebuilds), the layout
 * inputs, and the line's selection slice. Rows for a line whose inputs
 * changed rebuild on the spot.
 */
type RowCacheEntry = {
    decorations: LineDecorations;
    selKey: string;
    gutterWidth: number;
    lineNumDigits: number;
    bodyMaxWidth: number;
    showFocusGutter: boolean;
    showStateGutter: boolean;
    rows: Element[];
};

const rowCache = new WeakMap<RenderableLine, RowCacheEntry>();

function selectionKey(sel: LineSelection | null): string {
    return sel === null ? "" : `${sel.start}:${sel.end}:${sel.continuesRight ? 1 : 0}`;
}

function cachedLineRows(
    line: RenderableLine,
    decorations: LineDecorations,
    opts: {
        scrollId: string;
        gutterWidth: number;
        lineNumDigits: number;
        bodyMaxWidth: number;
        showFocusGutter: boolean;
        showStateGutter: boolean;
        onOpenPath?: (path: string, options: { activate: boolean }) => void;
    },
    selection: LineSelection | null
): Element[] {
    const selKey = selectionKey(selection);
    const cached = rowCache.get(line);
    if (
        cached !== undefined &&
        cached.decorations === decorations &&
        cached.selKey === selKey &&
        cached.gutterWidth === opts.gutterWidth &&
        cached.lineNumDigits === opts.lineNumDigits &&
        cached.bodyMaxWidth === opts.bodyMaxWidth &&
        cached.showFocusGutter === opts.showFocusGutter &&
        cached.showStateGutter === opts.showStateGutter
    ) {
        return cached.rows;
    }
    const rows = buildLineRows(line, decorations, opts, selection);
    rowCache.set(line, {
        decorations,
        selKey,
        gutterWidth: opts.gutterWidth,
        lineNumDigits: opts.lineNumDigits,
        bodyMaxWidth: opts.bodyMaxWidth,
        showFocusGutter: opts.showFocusGutter,
        showStateGutter: opts.showStateGutter,
        rows,
    });
    return rows;
}

/**
 * Index of the first entry whose rows reach past `row` — i.e. the first
 * entry the visible window can intersect. `entryRowEnd` is nondecreasing,
 * so this is a binary search. Returns `entryRowEnd.length` when every
 * entry ends at or before `row`.
 */
export function firstEntryIntersecting(
    entryRowEnd: readonly number[],
    row: number
): number {
    let lo = 0;
    let hi = entryRowEnd.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (entryRowEnd[mid] > row) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

function getFollowMeta(scrollId: string): FollowMeta {
    let m = followStates[scrollId];
    if (!m) {
        m = {
            lastFollowAt: 0,
            focusedId: null,
            focusedSeenAt: 0,
            lastResolvedIdx: -1,
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
            const phaseStart = Date.now();
            try {
                return buildCodeViewChildren(props);
            } finally {
                recordPhase("codeview", Date.now() - phaseStart);
            }
        },
    });
}

function buildCodeViewChildren(props: CodeViewProps): Element[] {
    const lineDecorator = extract(props.lineDecorator);
    const sourcePath = props.source !== undefined ? extract(props.source) : null;
    const sourceImportJsonPath =
        props.sourceImportJsonPath !== undefined
            ? extract(props.sourceImportJsonPath)
            : null;
    const viewIdentity =
        sourcePath !== null && sourcePath.length > 0
            ? `${sourceImportJsonPath ?? ""}\n${sourcePath}`
            : "__live__";
    let lines: readonly RenderableLine[] | null = null;
    if (props.lines !== undefined) {
        const explicit = extract(props.lines);
        if (explicit !== null && explicit.length > 0) {
            lines = explicit;
        }
    }
    if (lines === null && sourcePath !== null) {
        lines = linesForFile(sourcePath, sourceImportJsonPath);
    }
    if (lines === null || lines.length === 0) {
        delete modelCache[props.scrollId];
        publishCodeView(props.scrollId, viewIdentity, []);
        return buildEmptyMessageRows(
            props.emptyMessage === undefined ? "(no file)" : extract(props.emptyMessage),
            bodyWidthForScroll(props.scrollId, 0, false, false)
        );
    }

    // ── Whole-file model (decorations + row offsets) ─────────
    // O(total lines); reused across frames while its inputs are
    // unchanged, so eased-scroll rebuilds skip straight to the
    // visible-window slice below.
    const decoratorKey = lineDecorator.modelKey();
    const viewportW = getScrollState(props.scrollId).viewportRect.w;
    const cachedModel = modelCache[props.scrollId];
    let model: LineModel;
    if (
        decoratorKey !== null &&
        cachedModel !== undefined &&
        cachedModel.lines === lines &&
        cachedModel.decoratorKey === decoratorKey &&
        cachedModel.viewportW === viewportW
    ) {
        model = cachedModel.model;
    } else {
        model = buildLineModel(props.scrollId, lines, lineDecorator);
        if (decoratorKey !== null) {
            modelCache[props.scrollId] = {
                lines,
                decoratorKey,
                viewportW,
                model,
            };
        } else {
            delete modelCache[props.scrollId];
        }
    }
    const {
        decorated,
        entryRowStart,
        entryRowEnd,
        totalRows,
        lineIdToIndex,
        orderedLines,
        idToOrdinal,
        showFocusGutter,
        showStateGutter,
        gutterW,
        lineNumDigits,
        bodyMaxWidth,
    } = model;

    publishCodeView(props.scrollId, viewIdentity, orderedLines);
    const resolvedSelection = resolveSelection(
        getViewSelection(props.scrollId, viewIdentity),
        idToOrdinal
    );

    // ── Visibility window ────────────────────────────────────
    const scrollState = getScrollState(props.scrollId);
    const offset = scrollState.offset;
    const viewportH = scrollState.viewportRect.h > 0 ? scrollState.viewportRect.h : 0;
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
    const firstIdx = firstEntryIntersecting(entryRowEnd, firstVisibleRow);
    const skippedBeforeRows = firstIdx > 0 ? entryRowEnd[firstIdx - 1] : 0;
    let skippedAfterRows = 0;
    for (let i = firstIdx; i < decorated.length; i++) {
        if (entryRowStart[i] >= lastVisibleRow) {
            skippedAfterRows = totalRows - entryRowStart[i];
            break;
        }
        const line = decorated[i].line;
        const dec = decorated[i].decorations;
        if (dec.extraLinesBefore !== undefined) {
            for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                const extra = dec.extraLinesBefore[j];
                const rows = cachedLineRows(
                    extra.line,
                    extra.decorations,
                    {
                        scrollId: props.scrollId,
                        gutterWidth: gutterW,
                        lineNumDigits,
                        bodyMaxWidth,
                        showFocusGutter,
                        showStateGutter,
                        onOpenPath: props.onOpenPath,
                    },
                    lineSelectionFor(extra.line, resolvedSelection, idToOrdinal)
                );
                for (let k = 0; k < rows.length; k++) out.push(rows[k]);
            }
        }
        const rows = cachedLineRows(
            line,
            dec,
            {
                scrollId: props.scrollId,
                gutterWidth: gutterW,
                lineNumDigits,
                bodyMaxWidth,
                showFocusGutter,
                showStateGutter,
                onOpenPath: props.onOpenPath,
            },
            lineSelectionFor(line, resolvedSelection, idToOrdinal)
        );
        for (let k = 0; k < rows.length; k++) out.push(rows[k]);
    }

    if (skippedBeforeRows > 0) {
        out.unshift(spacerRows(skippedBeforeRows));
    }
    if (skippedAfterRows > 0) {
        out.push(spacerRows(skippedAfterRows));
    }

    if (props.autoFollow === true) {
        applyAutoFollow(props.scrollId, lineDecorator, lineIdToIndex);
    }
    return out;
}

/**
 * Cache of `wrapTokensIntoVisualRows`'s row count per RenderableLine.
 * The wrap result depends only on `line.tokens` (immutable per line)
 * and `bodyMaxWidth` (changes on resize). The virtualization pre-pass
 * calls this for every line every frame; without a cache that's the
 * dominant scroll-frame cost on long files.
 */
const wrapRowCountCache = new WeakMap<RenderableLine, { width: number; count: number }>();

function wrapRowCount(
    line: RenderableLine,
    bodyMaxWidth: number,
    dec: LineDecorations
): number {
    const effective = effectiveBodyWidth(bodyMaxWidth, dec);
    const cached = wrapRowCountCache.get(line);
    if (cached !== undefined && cached.width === effective) {
        return cached.count;
    }
    const wrapped = wrapTokensIntoVisualRows(line.tokens, effective);
    wrapRowCountCache.set(line, { width: effective, count: wrapped.length });
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

type ResolvedSelection = {
    startOrd: number;
    startCol: number;
    endOrd: number;
    endCol: number;
};

function resolveSelection(
    sel: {
        anchorId: string;
        anchorCol: number;
        focusId: string;
        focusCol: number;
    } | null,
    idToOrdinal: { [id: string]: number | undefined }
): ResolvedSelection | null {
    if (sel === null) return null;
    const aOrd = idToOrdinal[sel.anchorId];
    const fOrd = idToOrdinal[sel.focusId];
    if (aOrd === undefined || fOrd === undefined) return null;
    let start = { ord: aOrd, col: sel.anchorCol };
    let end = { ord: fOrd, col: sel.focusCol };
    if (end.ord < start.ord || (end.ord === start.ord && end.col < start.col)) {
        const swap = start;
        start = end;
        end = swap;
    }
    if (start.ord === end.ord && start.col === end.col) return null;
    return { startOrd: start.ord, startCol: start.col, endOrd: end.ord, endCol: end.col };
}

function lineSelectionFor(
    line: RenderableLine,
    resolved: ResolvedSelection | null,
    idToOrdinal: { [id: string]: number | undefined }
): LineSelection | null {
    if (resolved === null) return null;
    const ord = idToOrdinal[line.id];
    if (ord === undefined || ord < resolved.startOrd || ord > resolved.endOrd)
        return null;
    const len = joinTokenText(line.tokens).length;
    const start = ord === resolved.startOrd ? resolved.startCol : 0;
    const end = ord === resolved.endOrd ? resolved.endCol : len;
    const continuesRight = ord < resolved.endOrd;
    if (start >= end && !continuesRight) return null;
    return { start, end, continuesRight };
}

function hasFocusGutterContent(dec: LineDecorations): boolean {
    return dec.isFocused === true || dec.cursorColumnBackground !== undefined;
}

function hasStateGutterContent(dec: LineDecorations): boolean {
    return dec.state !== undefined;
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
    lineIdToIndex: { [id: string]: number | undefined }
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
    if (idx === undefined) return;

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
    const previousOffset = state.offset;
    setScrollOffset(scrollId, target);
    if (state.offset !== previousOffset) markGuiDirty();
    meta.lastFollowAt = now;
}

/**
 * Snaps the scroll back to the currently focused line and re-enables
 * autoscroll. Called from the "jump to current" pip.
 */
export function jumpToFocusedLine(scrollId: string): void {
    const meta = getFollowMeta(scrollId);
    const state = getScrollState(scrollId);
    const wasUserOverridden = state.userOverridden;
    clearUserScrollOverride(scrollId);
    // Force a re-resolve next frame so the next applyAutoFollow scrolls
    // immediately rather than skipping due to lastResolvedIdx match.
    meta.lastResolvedIdx = -1;
    meta.lastFollowAt = 0;
    if (wasUserOverridden) markGuiDirty();
}
