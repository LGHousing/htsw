import type { Action, Condition, Importable } from "htsw/types";

import { ACTION_MAPPINGS } from "../housingSync/fields/actionMappings";
import { CONDITION_MAPPINGS } from "../housingSync/fields/conditionMappings";
import { ALL_IMPORTABLE_TYPES } from "../importables/export/readers";

export type SuiteCoverage = {
    importableTypes: Set<string>;
    actionTypes: Set<string>;
    conditionTypes: Set<string>;
};

export function createCoverage(): SuiteCoverage {
    return {
        importableTypes: new Set<string>(),
        actionTypes: new Set<string>(),
        conditionTypes: new Set<string>(),
    };
}

export function collectImportablesCoverage(
    coverage: SuiteCoverage,
    importables: readonly Importable[]
): void {
    for (let i = 0; i < importables.length; i++) {
        collectImportableCoverage(coverage, importables[i]);
    }
}

export function allImplementedImportableTypes(): string[] {
    const out: string[] = [];
    for (let i = 0; i < ALL_IMPORTABLE_TYPES.length; i++) {
        out.push(ALL_IMPORTABLE_TYPES[i]);
    }
    return out.sort();
}

export function allActionTypes(): string[] {
    return Object.keys(ACTION_MAPPINGS).sort();
}

export function allConditionTypes(): string[] {
    return Object.keys(CONDITION_MAPPINGS).sort();
}

export function uncovered(all: readonly string[], covered: Set<string>): string[] {
    const missing: string[] = [];
    for (let i = 0; i < all.length; i++) {
        if (!covered.has(all[i])) missing.push(all[i]);
    }
    return missing;
}

export function coverageMatchesSlice(
    coverage: SuiteCoverage,
    slice: string
): boolean {
    const key = slice.toLowerCase();
    return (
        setHasLower(coverage.importableTypes, key) ||
        setHasLower(coverage.actionTypes, key) ||
        setHasLower(coverage.conditionTypes, key)
    );
}

function setHasLower(set: Set<string>, key: string): boolean {
    let found = false;
    set.forEach((value) => {
        if (value.toLowerCase() === key) found = true;
    });
    return found;
}

function collectImportableCoverage(
    coverage: SuiteCoverage,
    importable: Importable
): void {
    coverage.importableTypes.add(importable.type);
    switch (importable.type) {
        case "FUNCTION":
            collectActionsCoverage(coverage, importable.actions);
            return;
        case "EVENT":
            collectActionsCoverage(coverage, importable.actions);
            return;
        case "COMMAND":
            collectActionsCoverage(coverage, importable.actions);
            return;
        case "REGION":
            collectActionsCoverage(coverage, importable.onEnterActions);
            collectActionsCoverage(coverage, importable.onExitActions);
            return;
        case "ITEM":
            collectActionsCoverage(coverage, importable.leftClickActions);
            collectActionsCoverage(coverage, importable.rightClickActions);
            return;
        case "MENU":
            for (let i = 0; i < importable.slots.length; i++) {
                collectActionsCoverage(coverage, importable.slots[i].actions);
            }
            return;
        case "NPC":
            collectActionsCoverage(coverage, importable.leftClickActions);
            collectActionsCoverage(coverage, importable.rightClickActions);
            return;
        case "TEAM":
        case "GROUP":
            return;
        default: {
            const _exhaustive: never = importable;
            return _exhaustive;
        }
    }
}

function collectActionsCoverage(
    coverage: SuiteCoverage,
    actions: readonly Action[] | undefined
): void {
    if (actions === undefined) return;
    for (let i = 0; i < actions.length; i++) {
        collectActionCoverage(coverage, actions[i]);
    }
}

function collectActionCoverage(coverage: SuiteCoverage, action: Action): void {
    coverage.actionTypes.add(action.type);
    switch (action.type) {
        case "CONDITIONAL":
            collectConditionsCoverage(coverage, action.conditions);
            collectActionsCoverage(coverage, action.ifActions);
            collectActionsCoverage(coverage, action.elseActions);
            return;
        case "RANDOM":
            collectActionsCoverage(coverage, action.actions);
            return;
        default:
            return;
    }
}

function collectConditionsCoverage(
    coverage: SuiteCoverage,
    conditions: readonly Condition[] | undefined
): void {
    if (conditions === undefined) return;
    for (let i = 0; i < conditions.length; i++) {
        coverage.conditionTypes.add(conditions[i].type);
    }
}
