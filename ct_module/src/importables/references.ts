import type { Action, Condition, Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { unique } from "../utils/helpers";
import { ensureFunctionNamesExist } from "./functions/shared";
import { ensureMenuNamesExist } from "./menus/shared";
import { ensureRegionNamesExist } from "./regions/shared";

export type ReferencedImportables = {
    functions: string[];
    menus: string[];
    regions: string[];
};

export async function ensureReferencedImportablesExist(
    ctx: TaskContext,
    importable: Importable
): Promise<void> {
    const refs = collectReferencedImportables(importable);
    if (refs.functions.length > 0) {
        await ensureFunctionNamesExist(ctx, refs.functions);
    }
    if (refs.menus.length > 0) {
        await ensureMenuNamesExist(ctx, refs.menus);
    }
    if (refs.regions.length > 0) {
        await ensureRegionNamesExist(ctx, refs.regions);
    }
}

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
        functions: unique(refs.functions),
        menus: unique(refs.menus),
        regions: unique(refs.regions),
    };
}

function collectActionReferences(
    actions: readonly Action[] | undefined,
    refs: ReferencedImportables
): void {
    if (!actions) return;

    for (const action of actions) {
        if (action.type === "FUNCTION") {
            refs.functions.push(action.function);
        } else if (action.type === "SET_MENU") {
            refs.menus.push(action.menu);
        } else if (action.type === "CONDITIONAL") {
            collectConditionReferences(action.conditions, refs);
            collectActionReferences(action.ifActions, refs);
            collectActionReferences(action.elseActions, refs);
        } else if (action.type === "RANDOM") {
            collectActionReferences(action.actions, refs);
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
