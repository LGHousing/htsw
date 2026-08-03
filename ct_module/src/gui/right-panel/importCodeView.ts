/// <reference types="../../../CTAutocomplete" />

import { CodeView, jumpToFocusedLine } from "../code-view/codeView";
import { COLOR_BY_STATE, ROW_BG_BY_STATE } from "../code-view/diffPalette";
import type {
    LineDecorations,
    LineDecorator,
    RenderableLine,
} from "../code-view/lineTypes";
import { Button, Icon } from "../lib/components";
import {
    clearUserScrollOverride,
    isScrollUserOverridden,
    type Element,
} from "../lib/layout";
import { Icons } from "../lib/icons.generated";
import { markGuiDirty } from "../lib/dirty";
import {
    ACCENT_PURPLE,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
} from "../lib/theme";
import { ActionPath, ActionTreePath } from "../../housingSync/actionPath";
import type { DiffOpKind } from "../../housingSync/syncEvents";
import {
    effectiveFocusActionPath,
    getCurrentOperation,
    getCurrentPath,
    getLiveSummary,
    previewLineIdForPath,
    previewLinesForFile,
    previewRevision,
    type PreviewLine,
} from "./import-tab/livePreview";
import { focusLineIdForFile } from "./import-tab/focusedLine";
import { getActivePath } from "./selection";
import {
    getSessionVerb,
    getTaskProgress,
    getTaskViewIdentity,
} from "./import-tab/taskProgress";

const SCROLL_ID = "right-live-preview-scroll";
const COLOR_PENDING_GRAY = 0xff666666 | 0;
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;
const COLOR_MOVE_ROW_BG = 0x55351f3d | 0;

let followRequested = true;
let followIdentity = "";

export function ImportCodeView(): Element {
    return CodeView({
        scrollId: SCROLL_ID,
        viewIdentity: () => getTaskViewIdentity(getActivePath()),
        lines: () => {
            const path = getActivePath();
            return path === null ? null : previewLinesForFile(path);
        },
        lineDecorator: () => importProgressDecorator(getActivePath()),
        autoFollow: () => advanceFollowState(),
        emptyMessage: () => {
            if (getTaskProgress() !== null) {
                const verb = getSessionVerb();
                if (verb === "export") return "Exporting...";
                if (verb === "read") return "Reading house contents...";
                if (verb === "diff") return "Scanning Housing...";
                return "Importing...";
            }
            return "No live diff to show.";
        },
    });
}

export function ImportCodeViewFollowButton(): Element {
    return Button({
        children: [
            Icon({
                name: () => (followRequested ? Icons.locateFixed : Icons.locate),
                style: {
                    width: { kind: "px", value: 12 },
                    height: { kind: "px", value: 12 },
                },
            }),
        ],
        tooltip: "Follow the current code operation — turns off when you scroll",
        style: {
            width: { kind: "px", value: 18 },
            height: { kind: "grow" },
            padding: { side: "x", value: 0 },
            background: () => (followRequested ? COLOR_ROW_SELECTED : COLOR_BUTTON),
            hoverBackground: () =>
                followRequested ? COLOR_ROW_SELECTED_HOVER : COLOR_BUTTON_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            followRequested = !followRequested;
            if (followRequested) {
                clearUserScrollOverride(SCROLL_ID);
                jumpToFocusedLine(SCROLL_ID);
            }
            markGuiDirty();
        },
    });
}

function advanceFollowState(): boolean {
    const identity = getTaskViewIdentity(getActivePath());
    if (identity !== followIdentity) {
        followIdentity = identity;
        followRequested = true;
        clearUserScrollOverride(SCROLL_ID);
    } else if (followRequested && isScrollUserOverridden(SCROLL_ID)) {
        followRequested = false;
    }
    return followRequested;
}

function operationMarker(op: DiffOpKind): NonNullable<LineDecorations["marker"]> {
    if (op === "add") {
        return {
            glyph: "+",
            color: COLOR_BY_STATE.add,
            background: ROW_BG_BY_STATE.add,
        };
    }
    if (op === "delete") {
        return {
            glyph: "-",
            color: COLOR_BY_STATE.delete,
            background: ROW_BG_BY_STATE.delete,
        };
    }
    if (op === "move") {
        return {
            icon: Icons.arrowUpDown,
            color: ACCENT_PURPLE,
            background: COLOR_MOVE_ROW_BG,
        };
    }
    return {
        glyph: "~",
        color: COLOR_BY_STATE.edit,
        background: ROW_BG_BY_STATE.edit,
    };
}

function importProgressDecorator(path: string | null): LineDecorator {
    const currentOperation = path === null ? null : getCurrentOperation(path);
    const rawCurrentPath = path === null ? null : getCurrentPath(path);
    const isApplyPhase = path !== null && getLiveSummary(path) !== null;
    const focusPath =
        path === null || rawCurrentPath === null
            ? null
            : effectiveFocusActionPath(path, rawCurrentPath);
    const focusedLineId =
        path === null
            ? null
            : currentOperation !== null
              ? currentOperation.lineId
              : rawCurrentPath !== null
                ? previewLineIdForPath(path, rawCurrentPath)
                : focusLineIdForFile(path);

    return {
        decorateLine(line: RenderableLine): LineDecorations {
            const preview = line as PreviewLine;
            const operationFocused =
                currentOperation !== null && line.id === currentOperation.lineId;
            let inReadFocusRange = false;
            if (
                currentOperation === null &&
                focusPath !== null &&
                line.actionPath !== undefined
            ) {
                inReadFocusRange = ActionTreePath.isWithinAction(
                    line.actionPath,
                    focusPath
                );
            }
            const isFocused = focusedLineId !== null && line.id === focusedLineId;
            const marker = operationFocused
                ? operationMarker(currentOperation.op)
                : undefined;
            const focusRowBg = inReadFocusRange
                ? COLOR_READ_FOCUS_ROW_BG
                : undefined;
            const focusColBg = operationFocused
                ? COLOR_APPLY_FOCUS_COLUMN_BG
                : undefined;

            if (preview.completed === true) {
                return {
                    isFocused,
                    marker,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.variant === "placeholder") {
                return {
                    marker,
                    foregroundColor: COLOR_PENDING_GRAY,
                    italic: true,
                    hideLineNum: true,
                    isFocused,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (line.actionPath === undefined) return { isFocused: false };
            return {
                marker,
                foregroundColor: COLOR_PENDING_GRAY,
                isFocused,
                background: focusRowBg,
                cursorColumnBackground: focusColBg,
            };
        },
        focusedLineId(): string | null {
            return focusedLineId;
        },
        gutterVisibility(): { focus: boolean; marker: boolean } {
            return { focus: path !== null, marker: getSessionVerb() === "import" };
        },
        modelKey(): string | null {
            if (path === null) return "progress:none";
            const focusKey = focusPath === null ? "" : ActionPath.key(focusPath);
            const operationKey =
                currentOperation === null
                    ? ""
                    : `${currentOperation.op}:${currentOperation.lineId}`;
            return `progress:${path}\n${previewRevision(path)}\n${focusKey}\n${operationKey}\n${isApplyPhase}\n${getSessionVerb()}`;
        },
    };
}
