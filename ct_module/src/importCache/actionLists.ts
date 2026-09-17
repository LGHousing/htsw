import type { Action, Importable } from "htsw/types";

export type ImportableActionList = {
    basePath: string;
    actions: readonly Action[];
};

/**
 * A menu slot's action-list path, keyed by Housing slot number. A menu has no
 * inherent slot order, so array position would hand a slot its neighbor's
 * cached list and lock hash whenever the source inserts or reorders slots.
 */
export function menuSlotActionsPath(slot: number): string {
    return `slot#${slot}.actions`;
}

export function actionListsOfImportable(importable: Importable): ImportableActionList[] {
    const lists: ImportableActionList[] = [];
    switch (importable.type) {
        case "FUNCTION":
        case "EVENT":
        case "COMMAND":
            lists.push({ basePath: "actions", actions: importable.actions ?? [] });
            break;
        case "REGION":
            if (importable.onEnterActions !== undefined) {
                lists.push({
                    basePath: "onEnterActions",
                    actions: importable.onEnterActions,
                });
            }
            if (importable.onExitActions !== undefined) {
                lists.push({
                    basePath: "onExitActions",
                    actions: importable.onExitActions,
                });
            }
            break;
        case "ITEM":
        case "NPC":
            if (importable.leftClickActions !== undefined) {
                lists.push({
                    basePath: "leftClickActions",
                    actions: importable.leftClickActions,
                });
            }
            if (importable.rightClickActions !== undefined) {
                lists.push({
                    basePath: "rightClickActions",
                    actions: importable.rightClickActions,
                });
            }
            break;
        case "MENU":
            for (const slot of importable.slots) {
                if (slot.actions !== undefined && slot.actions.length > 0) {
                    lists.push({
                        basePath: menuSlotActionsPath(slot.slot),
                        actions: slot.actions,
                    });
                }
            }
            break;
    }
    return lists;
}

export function readCachedActionList(
    importable: Importable,
    basePath: string
): readonly Action[] | undefined {
    if (
        (importable.type === "FUNCTION" ||
            importable.type === "EVENT" ||
            importable.type === "COMMAND") &&
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
        // A declared slot without `actions` has an empty action list. Walk
        // backwards so a duplicated slot number resolves to its last entry,
        // the same one the `lists` hashes keep.
        for (let i = importable.slots.length - 1; i >= 0; i--) {
            const slot = importable.slots[i];
            if (menuSlotActionsPath(slot.slot) === basePath) return slot.actions ?? [];
        }
    }
    return undefined;
}
