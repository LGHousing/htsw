import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import { eventActionsOpened } from "../waiters";

export function extractEventNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    if (lower === "go back" || lower === "close" || lower === "information") {
        return null;
    }
    return trimmed;
}

export async function openEventEditor(
    ctx: TaskContext,
    eventName: string
): Promise<void> {
    await ctx.expectAfter(
        () => ctx.runCommand("/eventactions"),
        eventActionsOpened()
    );

    const slot = ctx.tryGetMenuItemSlot(eventName);
    if (slot === null) {
        throw new Error(`No event named "${eventName}" in this housing.`);
    }
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}
