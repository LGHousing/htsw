import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../importer/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";
import { extractFunctionNameFromSlot } from "./shared";

const FUNCTION_LIST_CONFIG: PaginatedListConfig = {
    label: "function",
    emptyPlaceholderName: "No Functions!",
};

export async function listAllFunctionNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/functions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        FUNCTION_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractFunctionNameFromSlot(
                    removedFormatting(item.getName()),
                );
                if (extracted === null) continue;
                out.push({ index: i, name: extracted });
            }
            return out;
        },
    );

    return entries.map((e) => e.name);
}
