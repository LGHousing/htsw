/// <reference types="../../../CTAutocomplete" />

import { diffKey, getDiffEntry, ROW_BG_BY_STATE, type DiffState } from "../state/diff";
import { focusLineIdForFile } from "../state/codeViewState";
import type { LineDecorations, LineDecorator, RenderableLine } from "./types";
import type { PreviewLine } from "../state/importPreviewState";

const COLOR_PENDING_GRAY = 0xff666666 | 0;
const COLOR_GHOST_GRAY = 0xff444444 | 0;
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

function idEndsWith(id: string, suffix: string): boolean {
    return (
        id.length >= suffix.length
        && id.substring(id.length - suffix.length) === suffix
    );
}

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
            return null;
        },
    };
}

export function progressDecorator(path: string | null): LineDecorator {
    const base = diffDecorator(path);
    const key = path === null ? null : diffKey(path);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            const preview = line as PreviewLine;
            const entry = key === null ? undefined : getDiffEntry(key);

            const isApplyPhase = entry !== undefined && entry.summary !== null;

            const isBody = idEndsWith(line.id, ":body");
            // `<subListPath>:placeholder` is the consolidated placeholder;
            // `:slot<N>:placeholder` ids represent per-slot unhydrated lists.
            const isConsolidatedPlaceholder =
                idEndsWith(line.id, ":placeholder") && line.id.indexOf(":slot") < 0;

            // Read phase: highlight the whole subtree being walked.
            // Apply phase: narrow to the body line — nested children get their own focus.
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

            if (preview.completed === true) {
                return {
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.isGhost === true) {
                // Ghost shares actionPath with its body partner above; the cursor stays
                // on the body. Background set directly (not via state: "edit") so the
                // `~` glyph doesn't reappear here — the body line above already carries it.
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
