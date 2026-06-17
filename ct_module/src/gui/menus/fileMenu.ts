/// <reference types="../../../CTAutocomplete" />

import type { MenuAction } from "../lib/menu";
import { showInExplorer, openInVSCode } from "../../utils/osShell";
import {
    isInQueue,
    queueItemKey,
    queueItemsForPath,
    removeFromQueueKey,
    toggleQueue,
    type QueueItem,
} from "../right-panel/import-tab/queue";

function isImportJsonPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    return normalized === "import.json" || normalized.lastIndexOf("/import.json") === normalized.length - "/import.json".length;
}

/**
 * Build the queue-control entry for a file path that maps to one or more
 * concrete importables.
 */
function queueActionForPath(filePath: string): MenuAction | null {
    if (isImportJsonPath(filePath)) return null;
    const items = queueItemsForPath(filePath);
    if (items.length === 0) return null;
    // Multi-match: an htsl referenced by N importables. Treat the whole
    // group as a unit so the toggle reflects "are they all queued?"
    const allQueued = items.every((it) => isInQueue(queueItemKey(it)));
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
                for (const it of items) removeFromQueueKey(queueItemKey(it));
            } else {
                for (const it of items) toggleQueue(it);
            }
        },
    };
}

/**
 * The action list every file row should always end with — Add/Remove
 * from queue, then the generic OS-shell actions. Compose with side-
 * specific extras via `composeFileMenu`.
 */
function genericFileActions(filePath: string): MenuAction[] {
    const queueAction = queueActionForPath(filePath);
    const actions: MenuAction[] = [
        { label: "Show in explorer", onClick: () => showInExplorer(filePath) },
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
    filePath: string
): MenuAction[] {
    if (specific.length === 0) return genericFileActions(filePath);
    return specific.concat([{ kind: "separator" }], genericFileActions(filePath));
}

/**
 * Variant of `composeFileMenu` for callers that already have a fully-
 * resolved `QueueItem` in hand (an Importables row, say). Skips
 * the path-based scan and uses the item directly so the toggle is
 * unambiguous even when the file is referenced by several importables.
 */
export function composeImportableMenu(
    specific: MenuAction[],
    filePath: string,
    item: QueueItem
): MenuAction[] {
    const queued = isInQueue(queueItemKey(item));
    const queueAction: MenuAction = {
        label: queued ? "Remove from queue" : "Add to queue",
        onClick: () => {
            toggleQueue(item);
        },
    };
    const generics: MenuAction[] = [
        queueAction,
        { label: "Show in explorer", onClick: () => showInExplorer(filePath) },
        { label: "Open with VSCode", onClick: () => openInVSCode(filePath) },
    ];
    if (specific.length === 0) return generics;
    return specific.concat([{ kind: "separator" }], generics);
}
