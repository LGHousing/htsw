import { timedWaitForMenu } from "../../importer/helpers";
import TaskContext from "../../tasks/context";

/**
 * Strip nav slots out of an `/eventactions` menu row's display name.
 *
 * Unlike `/functions`, the event menu has no `(#NNNN)` id suffix and no
 * pagination (the EVENTS enum fits on a single page), so this is purely
 * a negative filter for the nav buttons that share the chest GUI with
 * the event slots. Returns the trimmed event name, or null if the row
 * is a nav button / decoration the caller should skip.
 */
export function extractEventNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    if (
        lower === "go back" ||
        lower === "close" ||
        lower === "information"
    ) {
        return null;
    }
    return trimmed;
}

/**
 * Open `/eventactions`, click the slot for `eventName`, and wait for
 * the action editor to render. Shared between the importer's
 * single-event sync and the exporter's per-event read.
 *
 * Throws if the event slot can't be found in the current menu (e.g. a
 * malformed event name). Mirrors `openFunctionEditor` from
 * `functions/shared.ts` minus the missing/create branch — events are a
 * fixed enum so a slot lookup miss is unambiguously a typo'd name.
 */
export async function openEventEditor(
    ctx: TaskContext,
    eventName: string
): Promise<void> {
    await ctx.runCommand("/eventactions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    const slot = ctx.tryGetItemSlot(eventName);
    if (slot === null) {
        throw new Error(`No event named "${eventName}" in this housing.`);
    }
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}
