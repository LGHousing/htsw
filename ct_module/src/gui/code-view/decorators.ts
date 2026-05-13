/// <reference types="../../../CTAutocomplete" />

/**
 * Built-in line decorators for the code view.
 *
 * `diffDecorator` — View tab. Static diff colour per line, no animation,
 * no auto-follow.
 *
 * `progressDecorator` — Import tab. Reads the in-memory `PreviewModel`
 * via the cast to `PreviewLine` for the live morph state, falls back to
 * the diff entry for non-preview lines (the View tab path), and drives
 * the Spotify-lyrics auto-scroll via `focusLineIdForFile`.
 *
 * Both decorators compose against `RenderableLine` so future decorators
 * (search highlight, blame, etc.) slot in alongside without touching the
 * code view itself.
 */

import { diffKey, getDiffEntry, ROW_BG_BY_STATE, type DiffState } from "../state/diff";
import { focusLineIdForFile } from "../state/codeViewState";
import type { LineDecorations, LineDecorator, RenderableLine } from "./types";
import type { PreviewLine } from "../state/importPreviewState";

/** Lines that have no diff state but should still render in gray (the
 *  "untouched / unread" tone). */
const COLOR_PENDING_GRAY = 0xff666666 | 0;

/** Ghost lines (future-edit preview) sit beneath the original body line
 *  and easily get mistaken for a separate real line. Render them noticeably
 *  dimmer than the regular pending-gray so the eye reads them as "preview"
 *  rather than "another action". */
const COLOR_GHOST_GRAY = 0xff444444 | 0;

/** Reading-phase focus tint: full-row blue strip across the action being
 *  read (head + nested children + close brace). Subtle so syntax tokens
 *  stay readable. */
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;

/** Apply-phase focus tint: brighter blue, applied ONLY to the cursor
 *  column (not the row), so it doesn't fight the diff-state row tint
 *  (gold/red/green) of an op currently in flight. */
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

/** Ends-with check that compiles cleanly under Rhino's ES5 lib. We avoid
 *  String.prototype.endsWith because it isn't in the CT runtime's ES5
 *  TypeScript lib selection. */
function idEndsWith(id: string, suffix: string): boolean {
    return (
        id.length >= suffix.length
        && id.substring(id.length - suffix.length) === suffix
    );
}

/**
 * View tab decorator: per-line diff state from the entry, no animation.
 */
export function diffDecorator(path: string | null): LineDecorator {
    const key = path === null ? null : diffKey(path);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (key === null || line.actionPath === undefined) return {};
            const entry = getDiffEntry(key);
            if (entry === undefined) return {};
            const state = entry.states.get(line.actionPath);
            if (state === undefined) {
                if (entry.currentPath === line.actionPath) {
                    return { state: "current", isFocused: true };
                }
                return {};
            }
            const isFocused = entry.currentPath === line.actionPath;
            const effective: DiffState = isFocused ? "current" : state;
            return { state: effective, isFocused };
        },
        focusedLineId(): string | null {
            return null; // View tab does not auto-follow.
        },
    };
}

/**
 * Import tab decorator: reads PreviewLine intrinsic state for morph
 * animation, plus the diff entry's `currentPath` for cursor focus.
 *
 * Phase model:
 *  - **Reading** (entry.summary === null): full-row blue tint over the
 *    action subtree being walked.
 *  - **Apply** (entry.summary !== null): column-only blue tint on the
 *    body line, so the row's own diff-state tint (gold/red/green) keeps
 *    showing through.
 *
 * Cursor (▶) lands on body or consolidated `:placeholder` lines only —
 * `:else` and `:close` (which share the parent's actionPath) are
 * filtered by suffix.
 */
export function progressDecorator(path: string | null): LineDecorator {
    const base = diffDecorator(path);
    const key = path === null ? null : diffKey(path);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            const preview = line as PreviewLine;
            const entry = key === null ? undefined : getDiffEntry(key);

            const isApplyPhase = entry !== undefined && entry.summary !== null;

            const isBody = idEndsWith(line.id, ":body");
            // Filter the per-slot `:slot<N>:placeholder` ids — those use
            // the same suffix but represent partially-hydrated lists. The
            // consolidated placeholder uses `<subListPath>:placeholder`
            // exactly, with no `:slot` infix.
            const isConsolidatedPlaceholder =
                idEndsWith(line.id, ":placeholder") && line.id.indexOf(":slot") < 0;

            // Focus range scope:
            // - Reading: whole subtree of the action being walked.
            // - Apply: just the body line — nested children get their
            //   own focus when the inner sync moves the cursor onto them.
            //   Without narrowing, editing a CONDITIONAL's conditions
            //   would tint the whole `if{}` range when only the head is
            //   actually being touched.
            let inFocusRange = false;
            if (
                entry !== undefined
                && entry.currentPath !== null
                && line.actionPath !== undefined
            ) {
                inFocusRange = isApplyPhase
                    ? isBody && line.actionPath === entry.currentPath
                    : (
                        line.actionPath === entry.currentPath
                        || line.actionPath.indexOf(entry.currentPath + ".") === 0
                    );
            }

            // Cursor (▶) lands on body or (during reading) on the
            // consolidated placeholder — both indicate "the importer is
            // touching this logical unit right now".
            const isCursorTarget = isApplyPhase
                ? isBody
                : (isBody || isConsolidatedPlaceholder);
            const isFocused =
                entry !== undefined
                && line.actionPath !== undefined
                && entry.currentPath === line.actionPath
                && isCursorTarget;

            const focusRowBg =
                inFocusRange && !isApplyPhase ? COLOR_READ_FOCUS_ROW_BG : undefined;
            const focusColBg =
                inFocusRange && isApplyPhase ? COLOR_APPLY_FOCUS_COLUMN_BG : undefined;

            // ── Preview-model-driven branches (live morph animation) ──

            if (preview.completed === true) {
                return {
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.isGhost === true) {
                // Suppress isFocused on the ghost — its body partner above
                // shares the same actionPath. The cursor lives on the body.
                // Background set DIRECTLY (not via state: "edit") to avoid
                // the `~` glyph appearing here too — the body line above
                // already carries it.
                return {
                    foregroundColor: COLOR_GHOST_GRAY,
                    italic: true,
                    hideLineNum: true,
                    background: ROW_BG_BY_STATE["edit"],
                    isFocused: false,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.isPlaceholder === true) {
                return {
                    foregroundColor: COLOR_PENDING_GRAY,
                    italic: true,
                    hideLineNum: true,
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.diffState !== undefined) {
                return {
                    state: preview.diffState,
                    foregroundColor: COLOR_PENDING_GRAY,
                    isFocused,
                    cursorColumnBackground: focusColBg,
                };
            }

            // ── Entry-driven fallback for non-preview-model lines ──

            if (path === null || key === null || line.actionPath === undefined) {
                return base.decorateLine(line);
            }
            if (entry === undefined) {
                return { foregroundColor: COLOR_PENDING_GRAY };
            }
            const info = entry.details.get(line.actionPath);
            const state = entry.states.get(line.actionPath);

            const isDone = info?.completed === true || state === "match";
            if (isDone) {
                return {
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }

            if (state === undefined || state === "unknown") {
                return {
                    foregroundColor: COLOR_PENDING_GRAY,
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }

            return {
                state,
                foregroundColor: COLOR_PENDING_GRAY,
                isFocused,
                cursorColumnBackground: focusColBg,
            };
        },
        focusedLineId(): string | null {
            return path === null ? null : focusLineIdForFile(path);
        },
    };
}
