/// <reference types="../../../../CTAutocomplete" />

import { Button, Col, Container } from "../../lib/components";
import type { Element } from "../../lib/layout";
import { isScrollUserOverridden } from "../../lib/layout";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT,
} from "../../lib/theme";
import { getActiveImportPath, getImportProgress, getSessionVerb } from "./importProgress";
import { CodeView, jumpToFocusedLine } from "../../code-view/codeView";
import { progressDecorator } from "../decorators";
import { previewLinesForFile } from "./livePreview";
import type { RenderableLine } from "../../code-view/lineTypes";

const PREVIEW_SCROLL_ID = "right-live-preview-scroll";

export function livePreviewBody(): Element {
    return Col({
        style: { width: { kind: "grow" }, height: { kind: "grow" }, gap: 0 },
        children: () => [
            jumpBackPipRow(),
            CodeView({
                scrollId: PREVIEW_SCROLL_ID,
                lines: () => extractLines(),
                lineDecorator: () => progressDecorator(getActiveImportPath()),
                autoFollow: true,
                scrollLocked: () => getActiveImportPath() !== null,
                emptyMessage: () => {
                    if (getImportProgress() !== null) {
                        const verb = getSessionVerb();
                        if (verb === "export") return "Exporting — progress below.";
                        if (verb === "read") return "Reading house contents — progress below.";
                        return "Importing — progress below.";
                    }
                    return "No import in progress. Queue something and click Import to see live changes here.";
                },
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
