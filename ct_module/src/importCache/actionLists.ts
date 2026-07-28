import type { Action, Importable } from "htsw/types";

export type ImportableActionList = {
    basePath: string;
    actions: readonly Action[];
};

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
            for (let i = 0; i < importable.slots.length; i++) {
                const actions = importable.slots[i].actions;
                if (actions !== undefined && actions.length > 0) {
                    lists.push({ basePath: `slots[${i}].actions`, actions });
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
        const match = basePath.match(/^slots\[(\d+)\]\.actions$/);
        if (match !== null) {
            const idx = Number(match[1]);
            if (idx < 0 || idx >= importable.slots.length) return undefined;
            return importable.slots[idx].actions;
        }
    }
    return undefined;
}

export function setImportableActionList(
    importable: Importable,
    basePath: string,
    actions: readonly Action[]
): boolean {
    const cloned = JSON.parse(JSON.stringify(actions)) as Action[];
    if (
        (importable.type === "FUNCTION" ||
            importable.type === "EVENT" ||
            importable.type === "COMMAND") &&
        basePath === "actions"
    ) {
        importable.actions = cloned;
        return true;
    }
    if (importable.type === "REGION") {
        if (basePath === "onEnterActions") {
            importable.onEnterActions = cloned;
            return true;
        }
        if (basePath === "onExitActions") {
            importable.onExitActions = cloned;
            return true;
        }
    }
    if (importable.type === "ITEM" || importable.type === "NPC") {
        if (basePath === "leftClickActions") {
            importable.leftClickActions = cloned;
            return true;
        }
        if (basePath === "rightClickActions") {
            importable.rightClickActions = cloned;
            return true;
        }
    }
    if (importable.type === "MENU") {
        const match = basePath.match(/^slots\[(\d+)\]\.actions$/);
        if (match !== null) {
            const index = Number(match[1]);
            if (index >= 0 && index < importable.slots.length) {
                importable.slots[index].actions = cloned;
                return true;
            }
        }
    }
    return false;
}
