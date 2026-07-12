/// <reference types="../../../CTAutocomplete" />

import * as htsw from "htsw";

import { ROW_BG_BY_STATE } from "../code-view/diffPalette";
import { ensureSourceDiff, getSourceDiffRevision, houseActionAt } from "../code-view/sourceDiff";
import { focusLineIdForFile } from "./import-tab/focusedLine";
import { htslLineToChatString } from "./syntax";
import type { LineDecorations, LineDecorator, RenderableLine } from "../code-view/lineTypes";
import {
    effectiveFocusActionPath,
    getCurrentPath,
    getLiveSummary,
    previewLineIdForPath,
    previewRevision,
    type PreviewLine,
} from "./import-tab/livePreview";

const COLOR_PENDING_GRAY = 0xff666666 | 0;
const COLOR_GHOST_GRAY = 0xff444444 | 0;
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

function houseVersionHoverLines(
    path: string,
    actionPath: string,
    importJsonPath?: string | null
): string[] | null {
    const house = houseActionAt(path, actionPath, importJsonPath);
    if (house === null) return null;
    let printed: string;
    try {
        printed = htsw.htsl.printAction(house);
    } catch (_e) {
        return null;
    }
    const firstLine = printed.split("\n")[0];
    return ["&7In the house:", htslLineToChatString(firstLine)];
}

export function diffDecorator(path: string | null, importJsonPath?: string | null): LineDecorator {
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (path === null || line.actionPath === undefined) return {};
            const overlay = ensureSourceDiff(path, importJsonPath);
            if (overlay === undefined) return {};
            const state = overlay.get(line.actionPath);
            if (state === undefined) return {};
            if (state === "edit") {
                const actionPath = line.actionPath;
                return {
                    state,
                    hoverLines: () => houseVersionHoverLines(path, actionPath, importJsonPath),
                };
            }
            if (state === "add") {
                return {
                    state,
                    hoverLines: () => ["&7Not in the house — an import adds this."],
                };
            }
            return { state };
        },
        focusedLineId(): string | null {
            return null;
        },
        modelKey(): string | null {
            if (path === null) return "diff:none";
            return `diff:${path}\n${importJsonPath ?? ""}\n${getSourceDiffRevision()}`;
        },
    };
}

export function progressDecorator(path: string | null): LineDecorator {
    // Resolve once per decorator construction: the deepest preview-line
    // ancestor of the live cursor. Both decorateLine (highlight) and
    // focusedLineId (scroll target) need to agree on this — otherwise the
    // scroll lands on one line and the highlight on a different one (or no
    // line at all, when the cursor has no exact preview match).
    const rawCurrentPath = path === null ? null : getCurrentPath(path);
    const isApplyPhase = path !== null && getLiveSummary(path) !== null;
    const focusPath =
        path === null || rawCurrentPath === null
            ? null
            : effectiveFocusActionPath(path, rawCurrentPath);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            const preview = line as PreviewLine;

            const isBody = preview.variant === "body";
            // Consolidated placeholder ids end in `:placeholder` only;
            // per-slot placeholders embed `:slot<N>:` in the id.
            const isConsolidatedPlaceholder =
                preview.variant === "placeholder" && line.id.indexOf(":slot") < 0;

            // Read phase: highlight the whole subtree being walked.
            // Apply phase: narrow to the body line — nested children get their own focus.
            let inFocusRange = false;
            if (focusPath !== null && line.actionPath !== undefined) {
                inFocusRange = isApplyPhase
                    ? isBody && line.actionPath === focusPath
                    : (
                        line.actionPath === focusPath
                        || line.actionPath.indexOf(focusPath + ".") === 0
                    );
            }

            const isCursorTarget = isApplyPhase
                ? isBody
                : (isBody || isConsolidatedPlaceholder);
            const isFocused =
                focusPath !== null
                && line.actionPath !== undefined
                && focusPath === line.actionPath
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

            // Untagged line: built from the cache/observed snapshot and not yet
            // diffed. Matched lines are marked `completed` (handled above), so a
            // still-untagged line is genuinely pending → renders gray.
            if (line.actionPath === undefined) return { isFocused: false };
            return {
                foregroundColor: COLOR_PENDING_GRAY,
                isFocused,
                background: focusRowBg,
                cursorColumnBackground: focusColBg,
            };
        },
        focusedLineId(): string | null {
            if (path === null) return null;
            const current = getCurrentPath(path);
            if (current !== null) {
                return previewLineIdForPath(path, current);
            }
            return focusLineIdForFile(path);
        },
        modelKey(): string | null {
            if (path === null) return "progress:none";
            return `progress:${path}\n${previewRevision(path)}\n${focusPath ?? ""}\n${isApplyPhase}`;
        },
    };
}
