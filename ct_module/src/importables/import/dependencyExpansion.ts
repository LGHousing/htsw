import type { ImportablesParseResult } from "htsw";
import type { Importable, ImportableItem } from "htsw/types";

import {
    createItemDependencyIndex,
    type ItemDependencyIndex,
} from "../items/dependencyIndex";
import {
    expandClickActionItemDependencies,
    expandDeclaredTeamAndGroupDependencies,
    referencedItemNames,
} from "../items/dependencies";
import {
    createProjectItemIndex,
    type ProjectItemIndex,
} from "../items/projectItems";

export type ImportDependencyExpansion = {
    importables: Importable[];
    addedImportables: Importable[];
    addedItems: ImportableItem[];
    items: ProjectItemIndex;
    itemDependencies: ItemDependencyIndex;
};

export function orderImportablesForSession(
    _allImportables: readonly Importable[],
    selectedImportables: readonly Importable[]
): Importable[] {
    const prerequisites: Importable[] = [];
    const selectedItems: ImportableItem[] = [];
    const rest: Importable[] = [];
    for (const imp of selectedImportables) {
        if (imp.type === "TEAM" || imp.type === "GROUP") prerequisites.push(imp);
        else if (imp.type === "ITEM") selectedItems.push(imp);
        else rest.push(imp);
    }

    const itemsByName = new Map<string, ImportableItem>();
    for (const item of selectedItems) itemsByName.set(item.name, item);

    const orderedItems: Importable[] = [];
    const state = new Map<string, "visiting" | "done">();

    function visit(item: ImportableItem): void {
        const current = state.get(item.name);
        if (current === "done") return;
        if (current === "visiting") return;

        state.set(item.name, "visiting");
        for (const name of referencedItemNames(item)) {
            const dependency = itemsByName.get(name);
            if (dependency !== undefined) visit(dependency);
        }
        state.set(item.name, "done");
        orderedItems.push(item);
    }

    for (const item of selectedItems) visit(item);
    return prerequisites.concat(orderedItems, rest);
}

export function expandImportDependencies(
    parsed: ImportablesParseResult,
    selected: readonly Importable[],
    housingUuid: string
): ImportDependencyExpansion {
    const items = createProjectItemIndex(parsed.value, parsed.gcx);
    const itemDependencies = createItemDependencyIndex(parsed.value, items);
    const teamGroupExpansion = expandDeclaredTeamAndGroupDependencies(
        parsed.value,
        selected
    );
    const itemExpansion = expandClickActionItemDependencies(
        items,
        itemDependencies,
        teamGroupExpansion.importables,
        housingUuid
    );
    const addedImportables: Importable[] = [];
    for (const team of teamGroupExpansion.addedTeams) addedImportables.push(team);
    for (const group of teamGroupExpansion.addedGroups) addedImportables.push(group);
    for (const item of itemExpansion.addedItems) addedImportables.push(item);

    return {
        importables: orderImportablesForSession(
            parsed.value,
            itemExpansion.importables
        ),
        addedImportables,
        addedItems: itemExpansion.addedItems,
        items,
        itemDependencies,
    };
}
