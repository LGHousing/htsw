import type { Action, Condition, Importable, ImportableItem } from "htsw/types";

import { ACTION_MAPPINGS } from "../housingSync/fields/actionMappings";
import { CONDITION_MAPPINGS } from "../housingSync/fields/conditionMappings";
import { clickActionsHash, interactDataCachePath } from "../importCache";
import type { ItemRegistry } from "./itemRegistry";

type FieldSpec = { prop: string; kind: string };
type MappingTable = Record<string, { loreFields: Record<string, FieldSpec> } | undefined>;

function collectFromCondition(condition: Condition, names: string[]): void {
    const fields = (CONDITION_MAPPINGS as unknown as MappingTable)[condition.type]
        ?.loreFields;
    if (fields === undefined) return;
    for (const label in fields) {
        if (fields[label].kind !== "item") continue;
        const value = (condition as unknown as Record<string, unknown>)[
            fields[label].prop
        ];
        if (typeof value === "string") names.push(value);
    }
}

function collectFromActions(
    actions: readonly Action[] | undefined,
    names: string[]
): void {
    if (actions === undefined) return;
    for (const action of actions) {
        const fields = (ACTION_MAPPINGS as unknown as MappingTable)[action.type]
            ?.loreFields;
        if (fields === undefined) continue;
        for (const label in fields) {
            const field = fields[label];
            const value = (action as unknown as Record<string, unknown>)[field.prop];
            if (field.kind === "item") {
                if (typeof value === "string") names.push(value);
            } else if (field.kind === "nestedList" && Array.isArray(value)) {
                if (field.prop === "conditions") {
                    for (const condition of value as Condition[]) {
                        collectFromCondition(condition, names);
                    }
                } else {
                    collectFromActions(value as Action[], names);
                }
            }
        }
    }
}

/** Every item name referenced by a `kind: "item"` field anywhere in the importable's action trees. */
export function referencedItemNames(importable: Importable): string[] {
    const names: string[] = [];
    switch (importable.type) {
        case "FUNCTION":
        case "EVENT":
            collectFromActions(importable.actions, names);
            break;
        case "REGION":
            collectFromActions(importable.onEnterActions, names);
            collectFromActions(importable.onExitActions, names);
            break;
        case "MENU":
            for (const slot of importable.slots) {
                collectFromActions(slot.actions, names);
            }
            break;
        case "ITEM":
        case "NPC":
            collectFromActions(importable.leftClickActions, names);
            collectFromActions(importable.rightClickActions, names);
            break;
        default: {
            const _exhaustiveCheck: never = importable;
            return _exhaustiveCheck;
        }
    }
    return names;
}

/**
 * An item referenced by an action field must already exist in the house when
 * it carries click actions: the field writer spawns it from the per-housing
 * SNBT cache (`interact_data` is house-specific), and errors when that cache
 * entry is missing. Instead of leaving that error to fire mid-import, pull
 * each such declared-but-uncached item into the session up front so it
 * imports first. A stale cache entry (the declaration changed, so its hash
 * moved) counts as missing.
 *
 * Items without click actions resolve from the registry's stripped form and
 * need no expansion; references that don't resolve to a declared item are
 * left for the writer's existing diagnostics.
 */
export function expandClickActionItemDependencies(
    registry: ItemRegistry,
    selected: readonly Importable[],
    housingUuid: string
): { importables: Importable[]; addedItems: ImportableItem[] } {
    const presentNames = new Set<string>();
    for (const imp of selected) {
        if (imp.type === "ITEM") presentNames.add(imp.name);
    }

    const addedItems: ImportableItem[] = [];
    // Worklist: an added item's own click actions can reference further items.
    const queue: Importable[] = selected.slice();
    for (let i = 0; i < queue.length; i++) {
        const referenced = referencedItemNames(queue[i]);
        for (const name of referenced) {
            const item = registry.resolve(name)?.importable;
            if (item === undefined || presentNames.has(item.name)) continue;
            const hasClickActions =
                (item.leftClickActions !== undefined &&
                    item.leftClickActions.length > 0) ||
                (item.rightClickActions !== undefined &&
                    item.rightClickActions.length > 0);
            if (!hasClickActions) continue;
            const actionsHash = clickActionsHash(
                item.leftClickActions,
                item.rightClickActions
            );
            if (FileLib.exists(interactDataCachePath(housingUuid, actionsHash))) {
                continue;
            }
            presentNames.add(item.name);
            addedItems.push(item);
            queue.push(item);
        }
    }

    return { importables: selected.concat(addedItems), addedItems };
}
