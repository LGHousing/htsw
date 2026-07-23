/// <reference types="../../../CTAutocomplete" />

import type { MenuAction } from "../lib/menu";
import {
    showInExplorer,
    openInVSCode,
    revealInFilesLabel,
    setClipboardString,
} from "../../utils/osShell";
import {
    addToQueue,
    isQueueItemQueued,
    queueItemsForPath,
    removeFromQueue,
} from "../right-panel/import-tab/queue";

function isImportJsonPath(filePath: string): boolean {
    const normalized = filePath.split("\\").join("/").toLowerCase();
    const slash = normalized.lastIndexOf("/");
    const base = slash < 0 ? normalized : normalized.substring(slash + 1);
    return base === "import.json";
}
/**
 * Build the queue-control entry for a file path that maps to one or more
 * concrete importables.
 */
function queueActionForPath(filePath: string, importJsonPath?: string | null): MenuAction | null {
    if (isImportJsonPath(filePath)) return null;
    const items = queueItemsForPath(filePath, importJsonPath);
    if (items.length === 0) return null;
    // Multi-match: an htsl referenced by N importables. Treat the whole
    // group as a unit so the toggle reflects "are they all queued?"
    const allQueued = items.every(isQueueItemQueued);
    const label =
        items.length === 1
            ? allQueued
                ? "Remove from queue"
                : "Add to queue"
            : allQueued
              ? `Remove ${items.length} from queue`
              : `Add ${items.length} to queue`;
    return {
        label,
        onClick: () => {
            if (allQueued) {
                for (const it of items) removeFromQueue(it);
            } else {
                for (const it of items) addToQueue(it);
            }
        },
    };
}

/**
 * The action list every file row should always end with — Add/Remove
 * from queue, then the generic OS-shell actions. Compose with side-
 * specific extras via `composeFileMenu`.
 */
function genericFileActions(filePath: string, importJsonPath?: string | null): MenuAction[] {
    const queueAction = queueActionForPath(filePath, importJsonPath);
    const actions: MenuAction[] = [
        { label: revealInFilesLabel(), onClick: () => showInExplorer(filePath) },
        {
            label: "Copy path",
            onClick: () => {
                if (setClipboardString(filePath)) ChatLib.chat("&a[htsw] Copied path.");
            },
        },
        { label: "Open with VSCode", onClick: () => openInVSCode(filePath) },
    ];
    if (queueAction !== null) actions.unshift(queueAction);
    return actions;
}

/**
 * Build the full context menu for a file: panel-side `specific` actions
 * pinned to the top, a separator, then the always-present generics at the
 * bottom. Shared by the left panel's row right-click and the right
 * panel's tab right-click so both surfaces stay consistent.
 */
export function composeFileMenu(
    specific: MenuAction[],
    filePath: string,
    importJsonPath?: string | null
): MenuAction[] {
    if (specific.length === 0) return genericFileActions(filePath, importJsonPath);
    return specific.concat([{ kind: "separator" }], genericFileActions(filePath, importJsonPath));
}
