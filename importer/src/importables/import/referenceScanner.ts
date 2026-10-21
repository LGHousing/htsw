import type { Action, Condition, Importable } from "htsw/types";

import { getChildListFields } from "../../housingSync/fields/actionMappings";

export type ReferencedImportables = {
    functions: string[];
    menus: string[];
    regions: string[];
};

export function collectReferencedImportables(
    importable: Importable
): ReferencedImportables {
    const refs: ReferencedImportables = {
        functions: [],
        menus: [],
        regions: [],
    };

    if (importable.type === "FUNCTION") {
        collectActionReferences(importable.actions, refs);
    } else if (importable.type === "EVENT") {
        collectActionReferences(importable.actions, refs);
    } else if (importable.type === "COMMAND") {
        collectActionReferences(importable.actions, refs);
    } else if (importable.type === "REGION") {
        collectActionReferences(importable.onEnterActions, refs);
        collectActionReferences(importable.onExitActions, refs);
    } else if (importable.type === "ITEM") {
        collectActionReferences(importable.leftClickActions, refs);
        collectActionReferences(importable.rightClickActions, refs);
    } else if (importable.type === "MENU") {
        for (const slot of importable.slots) {
            collectActionReferences(slot.actions, refs);
        }
    } else if (importable.type === "NPC") {
        collectActionReferences(importable.leftClickActions, refs);
        collectActionReferences(importable.rightClickActions, refs);
    }

    return {
        functions: uniqueHousingNames(refs.functions),
        menus: uniqueHousingNames(refs.menus),
        regions: uniqueHousingNames(refs.regions),
    };
}

function uniqueHousingNames(values: readonly string[]): string[] {
    const names = new Map<string, string>();
    for (const value of values) {
        const key = value.toLowerCase();
        if (!names.has(key)) names.set(key, value);
    }
    return Array.from(names.values());
}

function collectActionReferences(
    actions: readonly Action[] | undefined,
    refs: ReferencedImportables
): void {
    if (!actions) return;

    for (const action of actions) {
        collectActionOwnReferences(action, refs);
        for (const field of getChildListFields(action.type)) {
            if (field.kind !== "actionList") continue;
            const value = (action as unknown as Record<string, unknown>)[field.prop];
            if (Array.isArray(value)) {
                collectChildActionReferences(value as Action[], refs);
            }
        }
    }
}

function collectChildActionReferences(
    actions: readonly Action[],
    refs: ReferencedImportables
): void {
    for (const action of actions) {
        collectActionOwnReferences(action, refs);
    }
}

function collectActionOwnReferences(action: Action, refs: ReferencedImportables): void {
    if (action.type === "FUNCTION") {
        refs.functions.push(action.function);
    } else if (action.type === "SET_MENU") {
        refs.menus.push(action.menu);
    }
    for (const field of getChildListFields(action.type)) {
        if (field.kind !== "conditionList") continue;
        const value = (action as unknown as Record<string, unknown>)[field.prop];
        if (Array.isArray(value)) {
            collectConditionReferences(value as Condition[], refs);
        }
    }
}

function collectConditionReferences(
    conditions: readonly Condition[] | undefined,
    refs: ReferencedImportables
): void {
    if (!conditions) return;

    for (const condition of conditions) {
        if (condition.type === "IS_IN_REGION" && condition.region) {
            refs.regions.push(condition.region);
        }
    }
}
