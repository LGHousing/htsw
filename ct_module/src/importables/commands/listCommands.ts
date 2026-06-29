import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";

const COMMAND_LIST_CONFIG: PaginatedListConfig = {
    label: "command",
    emptyPlaceholderName: "No commands!",
};

let sessionCommandNamesLower: Set<string> | null = null;

export function resetCommandNameSession(): void {
    sessionCommandNamesLower = null;
}

export function noteCommandCreated(name: string): void {
    if (sessionCommandNamesLower !== null) {
        sessionCommandNamesLower.add(name.toLowerCase());
    }
}

export async function getSessionCommandNamesLower(ctx: TaskContext): Promise<Set<string>> {
    if (sessionCommandNamesLower !== null) return sessionCommandNamesLower;
    const set = new Set<string>();
    const names = await listAllCommandNames(ctx);
    for (let i = 0; i < names.length; i++) {
        set.add(names[i].toLowerCase());
    }
    sessionCommandNamesLower = set;
    return set;
}

export function commandNameForHousing(name: string): string {
    return name.replace(/^\/+/, "");
}

export function extractCommandNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0 || trimmed.charAt(0) !== "/") return null;
    const withoutSlash = trimmed.substring(1);
    const m = withoutSlash.match(/^(.+?)\s*\(#[0-9a-fA-F]+\)\s*$/);
    return m !== null ? m[1] : withoutSlash;
}

export async function listAllCommandNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/commands");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        COMMAND_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractCommandNameFromSlot(
                    removedFormatting(item.getName())
                );
                if (extracted === null) continue;
                out.push({ index: i, name: extracted });
            }
            return out;
        }
    );

    return entries.map((e) => e.name);
}
