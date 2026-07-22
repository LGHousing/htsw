import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type TaskContext from "../../tasks/context";
import { eventActionsOpened } from "../waiters";

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
