import type { Action } from "htsw/types";

export type ChildActionListName = "ifActions" | "elseActions" | "actions";
export type ChildListName = "conditions" | ChildActionListName;
export type ActionPathPart = number | ChildActionListName;

export type ActionPath = {
    readonly kind: "action";
    readonly parts: readonly ActionPathPart[];
};

export type ActionListPath = {
    readonly kind: "actionList";
    readonly parts: readonly ActionPathPart[];
};

export type ConditionListPath = {
    readonly kind: "conditionList";
    readonly parent: ActionPath;
};

export type NestedListPath = ActionListPath | ConditionListPath;
export type ActionTreePath = ActionPath | NestedListPath;

declare const actionPathKeyBrand: unique symbol;
declare const actionTreePathKeyBrand: unique symbol;

export type ActionPathKey = string & { readonly [actionPathKeyBrand]: true };
export type ActionTreePathKey = string & { readonly [actionTreePathKeyBrand]: true };

export function rootActionListPath(): ActionListPath {
    return { kind: "actionList", parts: [] };
}

export function actionPathForIndex(
    listPath: ActionListPath | undefined,
    index: number
): ActionPath {
    return {
        kind: "action",
        parts: listPath === undefined ? [index] : listPath.parts.concat(index),
    };
}

export function childActionListPath(
    parent: ActionPath,
    prop: ChildActionListName
): ActionListPath {
    return { kind: "actionList", parts: parent.parts.concat(prop) };
}

export function conditionListPath(parent: ActionPath): ConditionListPath {
    return { kind: "conditionList", parent };
}

export function actionPathKey(path: ActionPath): ActionPathKey {
    return path.parts.map(String).join(".") as ActionPathKey;
}

export function actionTreePathKey(path: ActionTreePath): ActionTreePathKey {
    if (path.kind === "conditionList") {
        return `${actionPathKey(path.parent)}.conditions` as ActionTreePathKey;
    }
    return path.parts.map(String).join(".") as ActionTreePathKey;
}

export function actionPathEquals(a: ActionPath, b: ActionPath): boolean {
    return partsEqual(a.parts, b.parts);
}

export function actionTreePathEquals(a: ActionTreePath, b: ActionTreePath): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "conditionList" && b.kind === "conditionList") {
        return actionPathEquals(a.parent, b.parent);
    }
    if (a.kind === "conditionList" || b.kind === "conditionList") return false;
    return partsEqual(a.parts, b.parts);
}

export function actionPathDepth(path: ActionPath): number {
    return Math.floor((path.parts.length - 1) / 2);
}

export function actionIndex(path: ActionPath): number {
    return path.parts[path.parts.length - 1] as number;
}

export function actionListForAction(path: ActionPath): ActionListPath | undefined {
    if (path.parts.length === 1) return undefined;
    return { kind: "actionList", parts: path.parts.slice(0, -1) };
}

export function parentActionPath(path: ActionTreePath): ActionPath | null {
    if (path.kind === "conditionList") return path.parent;
    if (path.kind === "actionList") {
        if (path.parts.length < 2) return null;
        return { kind: "action", parts: path.parts.slice(0, -1) };
    }
    if (path.parts.length < 3) return null;
    return { kind: "action", parts: path.parts.slice(0, -2) };
}

export function nearestActionPath(path: ActionTreePath): ActionPath | null {
    return path.kind === "action" ? path : parentActionPath(path);
}

export function isPathWithinAction(path: ActionTreePath, ancestor: ActionPath): boolean {
    const parts: Array<ActionPathPart | "conditions"> = path.kind === "conditionList"
        ? path.parent.parts.slice()
        : path.parts.slice();
    if (path.kind === "conditionList") parts.push("conditions");
    return hasPartsPrefix(parts, ancestor.parts);
}

export function actionAtPath(
    actions: readonly Action[],
    path: ActionPath
): Action | null {
    let list = actions;
    let action: Action | null = null;
    for (let i = 0; i < path.parts.length; i++) {
        const part = path.parts[i];
        if (typeof part === "number") {
            action = list[part] ?? null;
            if (action === null) return null;
            continue;
        }
        if (action === null) return null;
        if (part === "ifActions" || part === "elseActions") {
            if (action.type !== "CONDITIONAL") return null;
            list = action[part];
        } else {
            if (action.type !== "RANDOM") return null;
            list = action.actions;
        }
        action = null;
    }
    return action;
}

export function actionPathFromParts(parts: readonly ActionPathPart[]): ActionPath {
    if (parts.length === 0 || parts.length % 2 === 0) {
        throw new Error("Action path must end at an action index");
    }
    for (let i = 0; i < parts.length; i++) {
        const expectedNumber = i % 2 === 0;
        if ((typeof parts[i] === "number") !== expectedNumber) {
            throw new Error("Action path parts must alternate index and child-list name");
        }
    }
    return { kind: "action", parts: parts.slice() };
}

function partsEqual(a: readonly ActionPathPart[], b: readonly ActionPathPart[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function hasPartsPrefix(
    parts: readonly (ActionPathPart | "conditions")[],
    prefix: readonly ActionPathPart[]
): boolean {
    if (parts.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (parts[i] !== prefix[i]) return false;
    }
    return true;
}
