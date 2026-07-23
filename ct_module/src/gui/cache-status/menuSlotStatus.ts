import type { Importable, MenuSlot } from "htsw/types";

import { menuSlotCompareKey } from "../../importables/menus/slotComparison";
import { peekImportableCache } from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { getHousingUuid } from "../state/housing";
import { isHouseTrusted } from "../state/trust";
import type { LinkStatusKey } from "./linkStatus";
import { itemDependencyIndexFor } from "../../importables/items/dependencyIndex";
import { requestImportableCacheWarm } from "./cacheWarm";

export type MenuSlotCacheStatus = { key: LinkStatusKey; tooltip: string };

// Memoized per slot object: a reparse replaces the slot objects, so the memo
// refreshes with the parse. Nothing edits a parsed menu slot in place today;
// if that ever changes, this needs the 250ms TTL treatment like
// `memoizedImportableHash`.
const canonicalMemo = new WeakMap<object, string>();
function slotCanonical(slot: MenuSlot): string {
    const hit = canonicalMemo.get(slot);
    if (hit !== undefined) return hit;
    const v = menuSlotCompareKey(slot);
    canonicalMemo.set(slot, v);
    return v;
}

/**
 * The file↔house link state for ONE menu slot, against the house's cached
 * copy of the menu. Slots are matched by Housing slot number, not array
 * position. Returns null when there's nothing trustworthy to compare
 * against (no house, untrusted house, or the menu was never read/imported)
 * — the menu row's own status icon covers those states.
 */
export function menuSlotCacheStatus(
    menu: Importable,
    slot: MenuSlot
): MenuSlotCacheStatus | null {
    if (menu.type !== "MENU") return null;
    const uuid = getHousingUuid();
    if (uuid === null || !isHouseTrusted(uuid)) return null;
    const cache = peekImportableCache(uuid, menu.type, importableIdentity(menu));
    if (!cache.loaded) {
        requestImportableCacheWarm(uuid, menu);
        return null;
    }
    const entry = cache.entry;
    if (entry === null || entry.importable.type !== "MENU") return null;
    const cachedSlots = entry.importable.slots;
    let cached: MenuSlot | null = null;
    for (let i = 0; i < cachedSlots.length; i++) {
        if (cachedSlots[i].slot === slot.slot) {
            cached = cachedSlots[i];
            break;
        }
    }
    if (cached === null) {
        return {
            key: "oneSided",
            tooltip: "Not in the house's menu — import to place it",
        };
    }
    const dependencies = itemDependencyIndexFor(menu);
    if (dependencies !== undefined) {
        const invalidations = dependencies.invalidationsFor(menu, entry.itemDependencies);
        for (const action of slot.actions ?? []) {
            if (invalidations.hasInvalidatedSubtree(action)) {
                return {
                    key: "differs",
                    tooltip: "A referenced item changed in this slot's actions",
                };
            }
        }
    }
    return slotCanonical(slot) === slotCanonical(cached)
        ? { key: "matches", tooltip: "Matches this house's menu" }
        : { key: "differs", tooltip: "Import will update this slot" };
}
