/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { getCurrentImportingPath } from "../state";
import { CodeView } from "../code-view/CodeView";
import { progressDecorator } from "../code-view/decorators";
import { previewLinesForFile } from "../state/importPreviewState";
import type { RenderableLine } from "../code-view/types";

/**
 * Live importer preview shown beneath the queue on the Import tab.
 *
 * Single source of truth: the PreviewModel. It is primed from the
 * knowledge cache when the diff sink is constructed, then morphed by
 * sink events through the read → hydrate → plan → apply → finalize
 * phases. The `.htsl` source file is no longer read here — `finalizeFromSource`
 * at end-of-import reconciles the model to the source shape.
 */
export function livePreviewBody(): Element {
    return CodeView({
        scrollId: "right-live-preview-scroll",
        lines: () => extractLines(),
        lineDecorator: () => progressDecorator(getCurrentImportingPath()),
        autoFollow: true,
        // Lock scroll while an import is active — autoFollow re-centres
        // the viewport every throttle tick anyway, so user wheel input
        // would just glitch back. Lock unconditionally; when no import
        // is active the scroll is empty so locking is a no-op.
        scrollLocked: () => getCurrentImportingPath() !== null,
        emptyMessage:
            "No import in progress. Queue something and click Import to see live changes here.",
    });
}

function extractLines(): readonly RenderableLine[] | null {
    const path = getCurrentImportingPath();
    if (path === null) return null;
    // PreviewLine is structurally compatible with RenderableLine — it
    // has the same id/lineNum/depth/tokens/actionPath fields plus the
    // preview-specific extras (italic / isGhost / isPlaceholder /
    // diffState / completed) that the decorator reads via cast.
    return previewLinesForFile(path);
}
