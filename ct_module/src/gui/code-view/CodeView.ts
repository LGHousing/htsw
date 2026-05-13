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
import type { LineDecorator, RenderableLine } from "./types";

export type CodeViewProps = {
    /**
     * Reactive file path. `null` renders the empty state. Used by the
     * View tab to read+parse a `.htsl` file each frame. Mutually
     * exclusive with `lines` — pass one or the other.
     */
    source?: Extractable<string | null>;
    /**
     * Reactive list of pre-built lines. Used by the Import tab's live
     * preview, where the line content is generated from observed
     * importer state rather than parsed from a file. `null` or empty
     * renders the empty state. Mutually exclusive with `source`.
     */
    lines?: Extractable<readonly RenderableLine[] | null>;
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
    /**
     * When true, lock the underlying Scroll so the user can't move the
     * viewport with mouse wheel or scrollbar drag. Use with `autoFollow`
     * for the import live preview, where a user-initiated scroll just
     * snaps back glitchily on the next throttle tick.
     */
    scrollLocked?: Extractable<boolean>;
    /** Empty-state message when source is null. */
    emptyMessage?: string;
};

const FOLLOW_THROTTLE_MS = 80;

// Per-scroll-id meta. Tracks the last time we centred the viewport so the
// recenter call doesn't fire every frame.
type FollowMeta = {
    lastFollowAt: number;
};

const followStates: { [id: string]: FollowMeta } = {};

function getFollowMeta(scrollId: string): FollowMeta {
    let m = followStates[scrollId];
    if (!m) {
        m = {
            lastFollowAt: 0,
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
            // Resolve lines via the caller's `lines` prop first, then
            // fall back to the `source` file. Returning null/empty from
            // `lines` is a "let source handle it" signal, NOT an
            // empty-state — the empty state is reserved for "neither
            // source nor lines yielded anything".
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
                return [
                    Text({
                        text: props.emptyMessage ?? "(no file)",
                        color: COLOR_TEXT_FAINT,
                        style: { padding: 6 },
                    }),
                ];
            }
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
 * Force the scroll offset to keep the focused line centred. No
 * suspend-on-user-input — during an import the user shouldn't be able to
 * scroll the live preview at all; any wheel input gets snapped back on
 * the next throttle tick. The throttle exists only to avoid re-issuing
 * the same setScrollOffset call every frame.
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
    if (now - meta.lastFollowAt < FOLLOW_THROTTLE_MS) return;

    const idx = lineIdToIndex[focusedId];
    if (idx === undefined) return;
    const viewportH = state.viewportRect.h;
    if (viewportH <= 0) return;
    const focusedY = idx * LINE_H;
    const target = Math.max(0, focusedY - Math.floor(viewportH / 2));
    setScrollOffset(scrollId, target);
    meta.lastFollowAt = now;
}
