import { Diagnostic } from "htsw";
import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry, getMemoizedHousingUuid } from "../../importables/itemRegistry";
import { itemWithInteractData } from "../../utils/nbt";
import { interactDataCachePath } from "../../importCache";

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
    itemRegistry: ItemRegistry,
    owner: Owner,
    itemName: string,
    kind: "action" | "condition"
): Promise<Item> {
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
    const dependencyIndex = itemRegistry.itemDependencies;
    if (dependencyIndex === undefined) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${owner.type}: its click-action dependencies were not indexed.`
        );
    }
    const cachePath = interactDataCachePath(
        uuid,
        dependencyIndex.clickActionsFingerprint(importable)
    );
    if (!FileLib.exists(cachePath)) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${owner.type}: it has click actions but its interact_data isn't cached at ${cachePath}. ` +
                `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                `or import it before whatever ${kind} references it.`
        );
    }
    const interactDataSnbt = String(FileLib.read(cachePath));
    return itemWithInteractData(importable.nbt, interactDataSnbt);
}
