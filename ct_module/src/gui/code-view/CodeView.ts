/// <reference types="../../../CTAutocomplete" />

/**
 * Shared file/source viewer used by both the View tab and the Import tab's
 * live preview. Owns no state — composes line data (`linesForFile`) with
 * a pluggable `LineDecorator` to build the element tree.
 *
 * Auto-follow (Spotify-lyrics scroll): when `autoFollow` is true and the
 * decorator reports a focused line, CodeView records the laid-out Y of
 * each line and scrolls the viewport to centre the focused line. The
 * auto-scroll suspends for ~1.5s after detecting user-driven scroll input.
 */

import { Scroll, Text } from "../lib/components";
import type { Element } from "../lib/layout";
import { getScrollState, setScrollOffset } from "../lib/layout";
import { extract, type Extractable } from "../lib/extractable";
import { COLOR_TEXT_FAINT } from "../lib/theme";
import { linesForFile } from "./lineModel";
import { buildLineRow, gutterWidthForLines, LINE_H } from "./lineRow";
import type { LineDecorator } from "./types";

export type CodeViewProps = {
    /** Reactive file path. `null` renders the empty state. */
    source: Extractable<string | null>;
    /** Unique scroll id; persists offset across frames. */
    scrollId: string;
    /** Reactive line decorator (re-extracted each frame).
     * NOTE: property key is `lineDecorator`, NOT `decorator`. CT 2.2.1's
     * Rhino fork treats the bare identifier `decorator` as a contextual
     * keyword (see docs/BUGS.md). When babel transpiles an inline arrow
     * `decorator: () => ...`, it infers the function name from the property
     * key, producing `function decorator() {...}` in the bundle — which
     * NPEs at parse time. Naming the prop `lineDecorator` dodges the trap
     * for every caller. */
    lineDecorator: Extractable<LineDecorator>;
    /** When true, auto-scroll the viewport to centre the focused line. */
    autoFollow?: boolean;
    /** Empty-state message when source is null. */
    emptyMessage?: string;
};

const USER_SCROLL_SUPPRESS_MS = 1500;
const FOLLOW_THROTTLE_MS = 250;

// Per-scroll-id meta. Tracks our own last programmatic offset so we can
// distinguish user scrolls from our own setScrollOffset calls.
type FollowMeta = {
    lastProgrammaticOffset: number;
    lastUserOffsetAt: number;
    lastFollowAt: number;
    lastFocusedLineId: string | null;
};

const followStates: { [id: string]: FollowMeta } = {};

function getFollowMeta(scrollId: string): FollowMeta {
    let m = followStates[scrollId];
    if (!m) {
        m = {
            lastProgrammaticOffset: 0,
            lastUserOffsetAt: 0,
            lastFollowAt: 0,
            lastFocusedLineId: null,
        };
        followStates[scrollId] = m;
    }
    return m;
}

export function CodeView(props: CodeViewProps): Element {
    return Scroll({
        id: props.scrollId,
        style: { height: { kind: "grow" }, gap: 0 },
        children: () => {
            const path = extract(props.source);
            if (path === null) {
                return [
                    Text({
                        text: props.emptyMessage ?? "(no file)",
                        color: COLOR_TEXT_FAINT,
                        style: { padding: 6 },
                    }),
                ];
            }
            const lineDecorator = extract(props.lineDecorator);
            const lines = linesForFile(path);
            const maxLineNum = lines.length === 0 ? 1 : lines.length;
            const gutterW = gutterWidthForLines(maxLineNum);
            const out: Element[] = [];
            // Map line id → FIRST rendered position (after extras), so
            // auto-follow lands on the head line of multi-line actions.
            const lineIdToIndex: { [id: string]: number } = {};
            let pos = 0;
            for (let i = 0; i < lines.length; i++) {
                const dec = lineDecorator.decorateLine(lines[i]);
                if (dec.extraLinesBefore !== undefined) {
                    for (let j = 0; j < dec.extraLinesBefore.length; j++) {
                        const extra = dec.extraLinesBefore[j];
                        if (lineIdToIndex[extra.line.id] === undefined) {
                            lineIdToIndex[extra.line.id] = pos;
                        }
                        out.push(buildLineRow(extra.line, extra.decorations, gutterW));
                        pos++;
                    }
                }
                if (lineIdToIndex[lines[i].id] === undefined) {
                    lineIdToIndex[lines[i].id] = pos;
                }
                out.push(buildLineRow(lines[i], dec, gutterW));
                pos++;
            }
            if (props.autoFollow === true) {
                applyAutoFollow(props.scrollId, lineDecorator, lineIdToIndex);
            }
            return out;
        },
    });
}

/**
 * Compute the target scroll offset to centre the focused line in the
 * viewport, and call `setScrollOffset` once per `FOLLOW_THROTTLE_MS` when
 * the focus has actually moved. Detects user-driven scrolls by comparing
 * the current offset to our last programmatic write — if they differ,
 * the user touched the scrollbar, so we suspend follow for
 * `USER_SCROLL_SUPPRESS_MS`.
 */
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

    // Detect user-driven scroll: offset diverged from our last write.
    if (
        meta.lastProgrammaticOffset !== state.offset &&
        Math.abs(state.offset - meta.lastProgrammaticOffset) > 1
    ) {
        meta.lastUserOffsetAt = now;
        meta.lastProgrammaticOffset = state.offset;
    }
    if (now - meta.lastUserOffsetAt < USER_SCROLL_SUPPRESS_MS) return;
    if (now - meta.lastFollowAt < FOLLOW_THROTTLE_MS) return;
    if (focusedId === meta.lastFocusedLineId) return;

    const idx = lineIdToIndex[focusedId];
    if (idx === undefined) return;
    const viewportH = state.viewportRect.h;
    if (viewportH <= 0) return;
    const focusedY = idx * LINE_H;
    const target = Math.max(0, focusedY - Math.floor(viewportH / 2));
    setScrollOffset(scrollId, target);
    meta.lastProgrammaticOffset = getScrollState(scrollId).offset;
    meta.lastFollowAt = now;
    meta.lastFocusedLineId = focusedId;
}
