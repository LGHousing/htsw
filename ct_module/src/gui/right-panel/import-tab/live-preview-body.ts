/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { getActiveImportPath } from "../../state";
import { CodeView } from "../../code-view/codeView";
import { progressDecorator } from "../../code-view/decorators";
import { previewLinesForFile } from "../../state/importPreviewState";
import type { RenderableLine } from "../../code-view/types";

export function livePreviewBody(): Element {
    return CodeView({
        scrollId: "right-live-preview-scroll",
        lines: () => extractLines(),
        lineDecorator: () => progressDecorator(getActiveImportPath()),
        autoFollow: true,
        autoFollowDelayMs: 500,
        scrollLocked: () => getActiveImportPath() !== null,
        emptyMessage:
            "No import in progress. Queue something and click Import to see live changes here.",
    });
}

function extractLines(): readonly RenderableLine[] | null {
    const path = getActiveImportPath();
    if (path === null) return null;
    return previewLinesForFile(path);
}
