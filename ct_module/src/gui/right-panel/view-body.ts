/// <reference types="../../../CTAutocomplete" />

import type { Element } from "../lib/layout";
import { getActivePath } from "../state/selection";
import { CodeView } from "../code-view/CodeView";
import { diffDecorator } from "../code-view/decorators";

/**
 * View tab source preview. Reads from `getActivePath` and applies the
 * static `diffDecorator` (no animation or auto-follow). Single call site —
 * everything else lives in the shared `CodeView` primitive.
 */
export function viewBody(): Element {
    return CodeView({
        scrollId: "right-source-scroll",
        source: () => getActivePath(),
        lineDecorator: () => diffDecorator(getActivePath()),
        autoFollow: false,
        emptyMessage:
            "Click an entry on the left to preview, double-click to pin a tab.",
    });
}
