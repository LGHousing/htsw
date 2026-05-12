import { Diagnostic } from "htsw";
import type { Action, Condition } from "htsw/types";

import TaskContext from "../tasks/context";
import { type ItemRegistry, getMemoizedHousingUuid } from "../importables/itemRegistry";
import { getItemFromSnbt } from "../utils/nbt";
import { importableHash, itemSnbtCachePath } from "../knowledge";

type Owner = Action | Condition;

/**
 * Resolves an item-name field on an action or condition to a real ItemStack
 * the writer can drop into a Housing item-input slot.
 *
 * If the item has click actions, we need a per-housing cached SNBT (its
 * `interact_data` is housing-scoped). Otherwise the registry's stripped form
 * is enough.
 */
export async function resolveImportableItem(
    ctx: TaskContext,
    itemRegistry: ItemRegistry | undefined,
    owner: Owner,
    itemName: string,
    kind: "action" | "condition"
): Promise<Item> {
    if (itemRegistry === undefined) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${owner.type}: no item registry is available.`
        );
    }

    const entry = itemRegistry.resolve(itemName, owner);
    if (entry === undefined) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${owner.type}: item fields resolve against top-level items[].name or direct .snbt paths.`
        );
    }

    const importable = entry.importable;
    const hasActions =
        importable !== undefined &&
        ((importable.leftClickActions !== undefined &&
            importable.leftClickActions.length > 0) ||
            (importable.rightClickActions !== undefined &&
                importable.rightClickActions.length > 0));
    if (!hasActions) {
        return entry.item;
    }

    const uuid = await getMemoizedHousingUuid(ctx, itemRegistry);
    const hash = importableHash(importable);
    const cachePath = itemSnbtCachePath(uuid, hash);
    if (!FileLib.exists(cachePath)) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${owner.type}: it has click actions but isn't cached at ${cachePath}. ` +
                `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                `or run /import on it before whatever ${kind} references it.`
        );
    }
    const snbt = String(FileLib.read(cachePath));
    return getItemFromSnbt(snbt);
}
