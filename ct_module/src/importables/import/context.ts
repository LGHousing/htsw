import type { ImportablesParseResult } from "htsw";

import type { ActionSyncContext } from "../../housingSync/actions/syncContext";
import type { ItemDependencyIndex } from "../items/dependencyIndex";
import type { ProjectItemIndex } from "../items/projectItems";
import type { NpcLookupCache } from "../npcs/listNpcs";

export type ImportContext = {
    parsed: ImportablesParseResult;
    items: ProjectItemIndex;
    housingUuid: string;
    itemDependencies: ItemDependencyIndex;
    npcLookup: NpcLookupCache;
    actions: ActionSyncContext;
};
