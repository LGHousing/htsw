import { Diagnostic } from "htsw";

import type { ResolveItemField } from "../../housingSync/items/itemReferences";
import { itemWithInteractData } from "../../utils/nbt";
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
        if (importable === undefined || !hasItemClickActions(importable)) {
            return entry.item;
        }
        if (dependencies === undefined || housingUuid === undefined) {
            throw Diagnostic.error(
                `Cannot set item "${itemName}" for ${owner.type}: its click-action dependencies were not prepared.`
            );
        }

        const interactData = readInteractDataCache(importable, dependencies, housingUuid);
        if (interactData === undefined) {
            throw Diagnostic.error(
                `Cannot set item "${itemName}" for ${owner.type}: it has click actions but its interact_data isn't cached. ` +
                    `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                    `or import it before whatever ${kind} references it.`
            );
        }
        return itemWithInteractData(entry.nbt, interactData);
    };
}
