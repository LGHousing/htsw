import { timedWaitForMenu } from "../../importer/gui/menuWait";
import TaskContext from "../../tasks/context";

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
    await ctx.runCommand("/eventactions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    const slot = ctx.tryGetItemSlot(eventName);
    if (slot === null) {
        throw new Error(`No event named "${eventName}" in this housing.`);
    }
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}
