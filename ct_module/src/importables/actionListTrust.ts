import type { Action, Importable } from "htsw/types";

import type { ActionListTrust } from "../importer/types";
import type { ImportableTrustPlan } from "../knowledge";

export function actionListTrustFor(
    plan: ImportableTrustPlan | undefined,
    basePath: string,
    desiredActions: readonly Action[]
): ActionListTrust | undefined {
    if (plan === undefined || plan.entry === null) {
        return undefined;
    }

    const cachedActions = readCachedActionList(plan.entry.importable, basePath);
    return {
        basePath,
        cachedActions: cachedActions ?? [],
        desiredActions,
        trustedListPaths: plan.trustedListPaths,
    };
}

export function readCachedActionList(
    importable: Importable,
    basePath: string
): readonly Action[] | undefined {
    if (
        (importable.type === "FUNCTION" || importable.type === "EVENT") &&
        basePath === "actions"
    ) {
        return importable.actions;
    }
    if (importable.type === "REGION") {
        if (basePath === "onEnterActions") return importable.onEnterActions;
        if (basePath === "onExitActions") return importable.onExitActions;
    }
    if (importable.type === "ITEM") {
        if (basePath === "leftClickActions") return importable.leftClickActions;
        if (basePath === "rightClickActions") return importable.rightClickActions;
    }
    if (importable.type === "NPC") {
        if (basePath === "leftClickActions") return importable.leftClickActions;
        if (basePath === "rightClickActions") return importable.rightClickActions;
    }
    if (importable.type === "MENU") {
        const match = basePath.match(/^slots\[(\d+)\]\.actions$/);
        if (match !== null) {
            const idx = Number(match[1]);
            const slot = importable.slots[idx];
            return slot?.actions;
        }
    }
    return undefined;
}
