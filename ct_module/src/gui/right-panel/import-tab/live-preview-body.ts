/// <reference types="../../../../CTAutocomplete" />

import type { Element } from "../../lib/layout";
import { getCurrentImportingPath } from "../../state";
import { CodeView } from "../../code-view/codeView";
import { progressDecorator } from "../../code-view/decorators";
import { previewLinesForFile } from "../../state/importPreviewState";
import type { RenderableLine } from "../../code-view/types";

export function livePreviewBody(): Element {
    return CodeView({
        scrollId: "right-live-preview-scroll",
        lines: () => extractLines(),
        lineDecorator: () => progressDecorator(getCurrentImportingPath()),
        autoFollow: true,
        scrollLocked: () => getCurrentImportingPath() !== null,
        emptyMessage:
            "No import in progress. Queue something and click Import to see live changes here.",
    });
}

function extractLines(): readonly RenderableLine[] | null {
    const path = getCurrentImportingPath();
    if (path === null) return null;
    return previewLinesForFile(path);
}
