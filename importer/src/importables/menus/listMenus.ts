import TaskContext from "../../tasks/context";
import {
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    paginatedEntryName,
    readPaginatedList,
    withoutNumericNote,
    type PaginatedListConfig,
} from "../../housingSync/menus/paginatedList";
import { menuListOpened } from "../waiters";

const MENU_LIST_CONFIG: PaginatedListConfig = {
    label: "menu",
    emptyPlaceholderName: "No custom menus!",
};

// Per-import-session set of the house's menu titles (lowercased), so the
// reference preflight can confirm a menu exists without a `/menu edit` per
// referenced name. Each such edit is a command, and Housing rate-limits
// commands (~1s, "this command is on cooldown"), so a function touching several
// menus would otherwise stall one cooldown at a time. Populated on first need,
// kept in sync as we create menus, reset at the start of each import session.
let sessionMenuNamesLower: Set<string> | null = null;

export function resetMenuNameSession(): void {
    sessionMenuNamesLower = null;
}

export function noteMenuCreated(name: string): void {
    if (sessionMenuNamesLower !== null) {
        sessionMenuNamesLower.add(name.toLowerCase());
    }
}

/**
 * The set of existing menu titles (lowercased) for this import session. Reads
 * the `/menus` GUI once and caches it; subsequent calls are free.
 */
export async function getSessionMenuNamesLower(ctx: TaskContext): Promise<Set<string>> {
    if (sessionMenuNamesLower !== null) return sessionMenuNamesLower;
    const set = new Set<string>();
    const names = await listAllMenuNames(ctx);
    for (let i = 0; i < names.length; i++) {
        set.add(names[i].toLowerCase());
    }
    sessionMenuNamesLower = set;
    return set;
}

export async function listAllMenuNames(ctx: TaskContext): Promise<string[]> {
    await ctx.expectAfter(
        () => ctx.runCommand("/menus"),
        menuListOpened()
    );

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        MENU_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                if (isEmptyPaginatedPlaceholder(slots[i], MENU_LIST_CONFIG)) continue;
                const item = slots[i].getItem();
                const name = paginatedEntryName(item.getName(), "Create Menu");
                if (name === null) continue;
                out.push({ index: i, name: withoutNumericNote(name) });
            }
            return out;
        }
    );

    return entries.map((e) => e.name);
}
