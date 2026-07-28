import type { ImportablesParseResult } from "htsw";

import type { ActionSyncContext } from "../../housingSync/actions/syncContext";
import type { ImportedItemPlacementSession } from "../../housingSync/items/heldItem";
import type { ItemDependencyIndex } from "../items/dependencyIndex";
import type { ProjectItemIndex } from "../items/projectItems";
import type { NpcLookupCache } from "../npcs/listNpcs";

export type ImportContext = {
    parsed: ImportablesParseResult;
    items: ProjectItemIndex;
    housingUuid: string;
    itemDependencies: ItemDependencyIndex;
    itemPlacement: ImportedItemPlacementSession;
    npcLookup: NpcLookupCache;
    actions: ActionSyncContext;
    ensuredReferencedShells: {
        functions: Set<string>;
        menus: Set<string>;
        regions: Set<string>;
    };
    plannedReferencedShells: {
        functions: Set<string>;
        menus: Set<string>;
        regions: Set<string>;
    };
};
