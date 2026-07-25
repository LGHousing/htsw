/// <reference types="../../../CTAutocomplete" />

import * as htsw from "htsw";

import { ROW_BG_BY_STATE } from "../code-view/diffPalette";
import {
    ensureSourceDiff,
    getSourceDiffRevision,
    type SourceDiffGhost,
} from "../code-view/sourceDiff";
import { focusLineIdForFile } from "./import-tab/focusedLine";
import { getSessionVerb } from "./import-tab/taskProgress";
import { tokenizeHtsl } from "./syntax";
import type {
    LineDecorations,
    LineDecorator,
    RenderableLine,
} from "../code-view/lineTypes";
import { ActionPath, ActionTreePath } from "../../housingSync/actionPath";
import {
    effectiveFocusActionPath,
    getCurrentPath,
    getLiveSummary,
    previewLineIdForPath,
    previewLinesForFile,
    previewRevision,
    type PreviewLine,
} from "./import-tab/livePreview";

const COLOR_PENDING_GRAY = 0xff666666 | 0;
const COLOR_GHOST_GRAY = 0xff444444 | 0;
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

export function diffDecorator(
    path: string | null,
    importJsonPath?: string | null
): LineDecorator {
    function ghostRows(ghosts: readonly SourceDiffGhost[]) {
        const rows: { line: RenderableLine; decorations: LineDecorations }[] = [];
        for (let i = 0; i < ghosts.length; i++) {
            let printed: string;
            try {
                printed = htsw.htsl.printAction(ghosts[i].action);
            } catch (_e) {
                printed = `${ghosts[i].action.type.toLowerCase()} ...`;
            }
            let printedLines = printed.split("\n");
            if (ghosts[i].headOnly) printedLines = printedLines.slice(0, 1);
            let indent = "";
            for (let depth = 0; depth < ghosts[i].depth; depth++) indent += "    ";
            for (let j = 0; j < printedLines.length; j++) {
                if (printedLines[j] === "" && j === printedLines.length - 1) continue;
                rows.push({
                    line: {
                        id: `static-ghost:${ghosts[i].id}:${j}`,
                        lineNum: 0,
                        depth: ghosts[i].depth,
                        tokens: tokenizeHtsl(indent + printedLines[j]),
                    },
                    decorations: {
                        state: "delete",
                        // An edit ghost shares the amber band with the source
                        // line below it, so the old/new pair reads as one
                        // edited unit rather than a delete next to an add.
                        background:
                            ROW_BG_BY_STATE[
                                ghosts[i].role === "edit" ? "edit" : "delete"
                            ],
                        foregroundColor: COLOR_GHOST_GRAY,
                        hideLineNum: true,
                    },
                });
            }
        }
        return rows;
    }

    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (path === null) return {};
            const overlay = ensureSourceDiff(path, importJsonPath);
            if (overlay === undefined) return {};
            const before = overlay.ghostsBeforeLine.get(line.lineNum);
            const extraLinesBefore = before === undefined ? undefined : ghostRows(before);
            if (line.actionPath === undefined) return { extraLinesBefore };
            if (line.actionPath.kind !== "action") return { extraLinesBefore };
            const actionPathKeyValue = ActionPath.key(line.actionPath);
            const state = overlay.states.get(actionPathKeyValue);
            if (state === undefined) return { extraLinesBefore };
            const itemHint = !overlay.changedItems.has(actionPathKeyValue)
                ? {}
                : {
                      hoverLines: () => ["&eReferenced item changed"],
                  };
            if (state === "edit") {
                if (overlay.itemOnlyChanges.has(actionPathKeyValue)) {
                    if (line.id !== `htsl:${actionPathKeyValue}`) {
                        return { extraLinesBefore };
                    }
                    return {
                        state: "edit",
                        extraLinesBefore,
                        ...itemHint,
                    };
                }
                if (line.id !== `htsl:${actionPathKeyValue}`) return { extraLinesBefore };
                return {
                    state: "add",
                    background: ROW_BG_BY_STATE["edit"],
                    extraLinesBefore,
                    ...itemHint,
                };
            }
            if (state === "add") {
                return {
                    state,
                    extraLinesBefore,
                };
            }
            return { state, extraLinesBefore };
        },
        focusedLineId(): string | null {
            return null;
        },
        extraLinesAtEnd() {
            if (path === null) return [];
            const overlay = ensureSourceDiff(path, importJsonPath);
            return overlay === undefined ? [] : ghostRows(overlay.ghostsAtEnd);
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
    let hasPendingFocusLine = false;
    if (path !== null && focusPath !== null) {
        const lines = previewLinesForFile(path);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
                line.variant === "body" &&
                line.actionPath?.kind === "action" &&
                ActionPath.equals(line.actionPath, focusPath) &&
                line.pending === true
            ) {
                hasPendingFocusLine = true;
                break;
            }
        }
    }
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
                    ? isBody &&
                      line.actionPath.kind === "action" &&
                      ActionPath.equals(line.actionPath, focusPath)
                    : ActionTreePath.isWithinAction(line.actionPath, focusPath);
            }

            const isCursorTarget = isApplyPhase
                ? isBody
                : isBody || isConsolidatedPlaceholder;
            const isFocused =
                focusPath !== null &&
                line.actionPath?.kind === "action" &&
                ActionPath.equals(focusPath, line.actionPath) &&
                isCursorTarget &&
                (hasPendingFocusLine
                    ? preview.pending === true
                    : preview.pending !== true);

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
                return {
                    state: "add",
                    hideLineNum: true,
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
        gutterVisibility(): { focus: boolean; state: boolean } {
            // The live cursor comes and goes with each nested read, so
            // reserve its column for the whole session instead of letting
            // rows shift sideways every time it blinks out. Diff-state
            // glyphs only ever appear for imports (apply-phase overlay);
            // export/read previews shouldn't pay for that blank column.
            return { focus: path !== null, state: getSessionVerb() === "import" };
        },
        modelKey(): string | null {
            if (path === null) return "progress:none";
            const focusKey = focusPath === null ? "" : ActionPath.key(focusPath);
            return `progress:${path}\n${previewRevision(path)}\n${focusKey}\n${isApplyPhase}\n${getSessionVerb()}`;
        },
    };
}
