/// <reference types="../../../../CTAutocomplete" />

import { Button, Col, Container, Text } from "../../lib/components";
import type { Element } from "../../lib/layout";
import { isScrollUserOverridden } from "../../lib/layout";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
} from "../../lib/theme";
import { getActiveImportPath } from "../../state";
import { CodeView, jumpToFocusedLine } from "../../code-view/codeView";
import { progressDecorator } from "../../code-view/decorators";
import { previewLinesForFile } from "../../state/livePreview";
import type { RenderableLine } from "../../code-view/lineTypes";

const PREVIEW_SCROLL_ID = "right-live-preview-scroll";

/**
 * Above this many lines the live code-view is paused during a run. Each
 * frame the view re-decorates and re-measures every line, and every
 * observed snapshot rebuilds the whole line array — for a multi-thousand-
 * line function that sustained per-frame cost starves the render/network
 * thread and can drop the server connection. The import itself is
 * unaffected; only the animation pauses past this size.
 */
const MAX_LIVE_PREVIEW_LINES = 600;

export function livePreviewBody(): Element {
    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" }, gap: 0 },
        children: () => {
            const lines = extractLines();
            if (lines !== null && lines.length > MAX_LIVE_PREVIEW_LINES) {
                return [largePreviewNotice(lines.length)];
            }
            return [
                jumpBackPipRow(),
                CodeView({
                    scrollId: PREVIEW_SCROLL_ID,
                    lines: () => extractLines(),
                    lineDecorator: () => progressDecorator(getActiveImportPath()),
                    autoFollow: true,
                    scrollLocked: () => getActiveImportPath() !== null,
                    emptyMessage:
                        "No import in progress. Queue something and click Import to see live changes here.",
                }),
            ];
        },
    });
}

function largePreviewNotice(lineCount: number): Element {
    return Container({
        style: {
            direction: "col",
            width: { kind: "grow" },
            height: { kind: "grow" },
            justify: "center",
            align: "center",
            padding: 8,
            gap: 4,
        },
        children: [
            Text({ text: `Large importable (${lineCount} lines)`, color: COLOR_TEXT }),
            Text({
                text: "Live preview paused to keep the game responsive — import is still running.",
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

function jumpBackPipRow(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "auto" },
        },
        children: () => {
            if (getActiveImportPath() === null) return [];
            if (!isScrollUserOverridden(PREVIEW_SCROLL_ID)) return [];
            return [
                Button({
                    icon: Icons.arrowDown,
                    text: "Jump to current",
                    style: {
                        width: { kind: "grow" },
                        height: { kind: "px", value: 14 },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    textColor: COLOR_TEXT,
                    onClick: () => jumpToFocusedLine(PREVIEW_SCROLL_ID),
                }),
            ];
        },
    });
}


function extractLines(): readonly RenderableLine[] | null {
    const path = getActiveImportPath();
    if (path === null) return null;
    return previewLinesForFile(path);
}
