import { timedWaitForMenu } from "../../importer/helpers";
import TaskContext from "../../tasks/context";
import { getMenuItemSlots } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { extractEventNameFromSlot } from "./shared";

/**
 * Walk the housing's `/eventactions` menu and return every event slot
 * name in menu order. The event list is a single chest GUI page (the
 * EVENTS enum is small enough that Hypixel doesn't paginate it), so
 * this is structurally simpler than the paginated function-list walker
 * and just reads container slots directly.
 *
 * Returns names as displayed in-game (matching the strings in EVENTS).
 * Caller is responsible for closing the menu — the next per-event
 * export call re-opens `/eventactions` to keep each iteration
 * self-contained, mirroring how the function exporter calls
 * `/function edit` per function.
 */
export async function listAllEventNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/eventactions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    const slots = getMenuItemSlots();
    if (slots === null) return [];

    const names: string[] = [];
    for (let i = 0; i < slots.length; i++) {
        const item = slots[i].getItem();
        if (item === null || item === undefined) continue;
        const extracted = extractEventNameFromSlot(
            removedFormatting(item.getName())
        );
        if (extracted === null) continue;
        names.push(extracted);
    }
    return names;
}
