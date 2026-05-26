/// <reference types="../../../CTAutocomplete" />

import { ROW_BG_BY_STATE } from "../state/diff";
import { ensureKnowledgeOverlay } from "../state/knowledgeOverlay";
import { focusLineIdForFile } from "../state/codeViewState";
import type { LineDecorations, LineDecorator, RenderableLine } from "./types";
import { getLiveOverlay, type PreviewLine } from "../state/importPreviewState";

const COLOR_PENDING_GRAY = 0xff666666 | 0;
const COLOR_GHOST_GRAY = 0xff444444 | 0;
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

export function diffDecorator(path: string | null): LineDecorator {
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (path === null || line.actionPath === undefined) return {};
            const overlay = ensureKnowledgeOverlay(path);
            if (overlay === undefined) return {};
            const state = overlay.get(line.actionPath);
            if (state === undefined) return {};
            return { state };
        },
        focusedLineId(): string | null {
            return null;
        },
    };
}

export function progressDecorator(path: string | null): LineDecorator {
    const base = diffDecorator(path);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            const preview = line as PreviewLine;
            const entry = path === null ? undefined : getLiveOverlay(path);

            const isApplyPhase = entry !== undefined && entry.summary !== null;

            const isBody = preview.variant === "body";
            // Consolidated placeholder ids end in `:placeholder` only;
            // per-slot placeholders embed `:slot<N>:` in the id.
            const isConsolidatedPlaceholder =
                preview.variant === "placeholder" && line.id.indexOf(":slot") < 0;

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
            if (preview.variant === "ghost") {
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
            if (preview.variant === "placeholder") {
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

            if (path === null || line.actionPath === undefined) {
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
