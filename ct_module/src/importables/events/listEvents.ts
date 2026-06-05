import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import TaskContext from "../../tasks/context";
import { getMenuItemSlots } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { extractEventNameFromSlot } from "./shared";

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
