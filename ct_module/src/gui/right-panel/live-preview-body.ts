/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { getCurrentImportingPath } from "../state";
import { CodeView } from "../code-view/CodeView";
import { progressDecorator } from "../code-view/decorators";

/**
 * Live importer preview shown beneath the queue on the Import tab. Reads
 * from `getCurrentImportingPath` and applies the `progressDecorator` —
 * static diff coloring + per-line freshness fade + focus follow.
 */
export function livePreviewBody(): Element {
    return CodeView({
        scrollId: "right-live-preview-scroll",
        source: () => getCurrentImportingPath(),
        lineDecorator: () => progressDecorator(getCurrentImportingPath()),
        autoFollow: true,
        emptyMessage:
            "No import in progress. Queue something and click Import to see live changes here.",
    });
}
