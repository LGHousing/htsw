import { Diagnostic } from "htsw";
import type { ImportableItem } from "htsw/types";

import { readImportableCache } from "../../importCache";
import { canonicalItemShellTagKey } from "../../housingSync/items/itemNbt";
import type { ResolveItemField } from "../../housingSync/items/itemReferences";
import { extractInteractDataSnbtFromNbt, itemWithInteractData } from "../../utils/nbt";
import type { ItemDependencyIndex } from "./dependencyIndex";
import { hasItemClickActions, readInteractDataCache } from "./interactDataCache";
import type { ProjectItemIndex } from "./projectItems";

export function createItemFieldResolver(
    projectItems: ProjectItemIndex,
    dependencies?: ItemDependencyIndex,
    housingUuid?: string
): ResolveItemField {
    return async (owner, itemName, kind) => {
        const entry = projectItems.resolve(itemName, owner);
        if (entry === undefined) {
            throw Diagnostic.error(
                `Cannot set item "${itemName}" for ${owner.type}: item fields resolve against top-level items[].name or direct .snbt paths.`
            );
        }

        const importable = entry.importable;
        if (importable === undefined) {
            return entry.item;
        }
        if (dependencies === undefined || housingUuid === undefined) {
            if (!hasItemClickActions(importable)) return entry.item;
            throw Diagnostic.error(
                `Cannot set item "${itemName}" for ${owner.type}: its click-action dependencies were not prepared.`
            );
        }

        const interactData = readHouseItemInteractData(
            importable,
            dependencies,
            housingUuid
        );
        if (interactData === undefined) {
            if (!hasItemClickActions(importable)) return entry.item;
            throw Diagnostic.error(
                `Cannot set item "${itemName}" for ${owner.type}: it has click actions but its interact_data isn't cached. ` +
                    `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                    `or import it before whatever ${kind} references it.`
            );
        }
        // Verified 2026-07-16: hand-minted stacks carrying this house's blob
        // satisfy item-field Metadata/consume checks. Whether GIVE_ITEM keeps
        // that blob when it gives a stack to a player is still unknown.
        return itemWithInteractData(importable.nbt, interactData);
    };
}

export function readHouseItemInteractData(
    item: ImportableItem,
    dependencies: ItemDependencyIndex,
    housingUuid: string
): string | undefined {
    const knowledge = readImportableCache(housingUuid, "ITEM", item.name);
    const knownItem = knowledge?.importable;
    if (
        knownItem?.type !== "ITEM" ||
        canonicalItemShellTagKey(knownItem.nbt) !== canonicalItemShellTagKey(item.nbt)
    ) {
        return undefined;
    }

    const embedded = extractInteractDataSnbtFromNbt(knownItem.nbt);
    if (embedded !== null) return embedded;
    return hasItemClickActions(item)
        ? readInteractDataCache(item, dependencies, housingUuid)
        : undefined;
}
