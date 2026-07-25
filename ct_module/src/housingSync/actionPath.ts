import type { Action, Condition } from "htsw/types";

// Addresses nodes in an action tree. A path's parts alternate action index and
// child-list name, so "2.ifActions.0" is the first action inside the third
// root action's If Actions list.

type ArrayFieldNames<TObject, TItem> = TObject extends unknown
    ? {
          [K in keyof TObject]-?: NonNullable<TObject[K]> extends readonly TItem[]
              ? K
              : never;
      }[keyof TObject]
    : never;

// Derive the names for possible action & condition child lists from mappings
export type ChildActionListName = Extract<ArrayFieldNames<Action, Action>, string>;
export type ChildConditionListName = Extract<ArrayFieldNames<Action, Condition>, string>;
export type ChildListName = ChildActionListName | ChildConditionListName;
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
    readonly prop: ChildConditionListName;
};

export type NestedListPath = ActionListPath | ConditionListPath;
export type ActionTreePath = ActionPath | NestedListPath;

declare const actionTreePathKeyBrand: unique symbol;
declare const actionPathKeyBrand: unique symbol;

type ActionTreePathKey = string & {
    readonly [actionTreePathKeyBrand]: true;
};
export type ActionPathKey = ActionTreePathKey & { readonly [actionPathKeyBrand]: true };

export const ActionPath = {
    at(list: ActionListPath | undefined, index: number): ActionPath {
        return {
            kind: "action",
            parts: list === undefined ? [index] : list.parts.concat(index),
        };
    },

    fromParts(parts: readonly ActionPathPart[]): ActionPath {
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
    },

    key(path: ActionPath): ActionPathKey {
        return path.parts.map(String).join(".") as ActionPathKey;
    },

    equals(a: ActionPath, b: ActionPath): boolean {
        return partsEqual(a.parts, b.parts);
    },

    depth(path: ActionPath): number {
        return Math.floor((path.parts.length - 1) / 2);
    },

    index(path: ActionPath): number {
        return path.parts[path.parts.length - 1] as number;
    },

    containingList(path: ActionPath): ActionListPath | undefined {
        if (path.parts.length === 1) return undefined;
        return { kind: "actionList", parts: path.parts.slice(0, -1) };
    },

    resolve(actions: readonly Action[], path: ActionPath): Action | null {
        let list = actions;
        let action: Action | null = null;
        for (let i = 0; i < path.parts.length; i++) {
            const part = path.parts[i];
            if (typeof part === "number") {
                if (part < 0 || part >= list.length) return null;
                const nextAction = (list as readonly (Action | undefined)[])[part];
                if (nextAction === undefined) return null;
                action = nextAction;
                continue;
            }
            if (action === null) return null;
            const childList = (action as unknown as Record<string, unknown>)[part];
            if (!Array.isArray(childList)) return null;
            list = childList as Action[];
            action = null;
        }
        return action;
    },
};

export const ActionListPath = {
    root(): ActionListPath {
        return { kind: "actionList", parts: [] };
    },

    childOf(parent: ActionPath, prop: ChildActionListName): ActionListPath {
        return { kind: "actionList", parts: parent.parts.concat(prop) };
    },
};

export const ConditionListPath = {
    of(parent: ActionPath, prop: ChildConditionListName): ConditionListPath {
        return { kind: "conditionList", parent, prop };
    },
};

export const ActionTreePath = {
    key(path: ActionTreePath): ActionTreePathKey {
        if (path.kind === "conditionList") {
            return `${ActionPath.key(path.parent)}.${path.prop}` as ActionTreePathKey;
        }
        return path.parts.map(String).join(".") as ActionTreePathKey;
    },

    equals(a: ActionTreePath, b: ActionTreePath): boolean {
        if (a.kind !== b.kind) return false;
        if (a.kind === "conditionList") {
            return ActionTreePath.key(a) === ActionTreePath.key(b);
        }
        return partsEqual(a.parts, (b as ActionListPath | ActionPath).parts);
    },

    parentAction(path: ActionTreePath): ActionPath | null {
        if (path.kind === "conditionList") return path.parent;
        if (path.kind === "actionList") {
            if (path.parts.length < 2) return null;
            return { kind: "action", parts: path.parts.slice(0, -1) };
        }
        if (path.parts.length < 3) return null;
        return { kind: "action", parts: path.parts.slice(0, -2) };
    },

    nearestAction(path: ActionTreePath): ActionPath | null {
        return path.kind === "action" ? path : ActionTreePath.parentAction(path);
    },

    isWithinAction(path: ActionTreePath, ancestor: ActionPath): boolean {
        const parts: Array<ActionPathPart | ChildConditionListName> =
            path.kind === "conditionList" ? path.parent.parts.slice() : path.parts.slice();
        if (path.kind === "conditionList") parts.push(path.prop);
        return hasPartsPrefix(parts, ancestor.parts);
    },

    indexAtList(
        path: ActionTreePath,
        listPath: ActionListPath | undefined
    ): number | null {
        const parts = path.kind === "conditionList" ? path.parent.parts : path.parts;
        const listParts = listPath === undefined ? [] : listPath.parts;
        if (!hasPartsPrefix(parts, listParts)) return null;
        const index = parts[listParts.length];
        return typeof index === "number" ? index : null;
    },

    replaceIndexAtList(
        path: ActionTreePath,
        listPath: ActionListPath | undefined,
        index: number
    ): ActionTreePath | null {
        if (ActionTreePath.indexAtList(path, listPath) === null) return null;
        const parts =
            path.kind === "conditionList"
                ? path.parent.parts.slice()
                : path.parts.slice();
        const listDepth = listPath === undefined ? 0 : listPath.parts.length;
        parts[listDepth] = index;
        if (path.kind === "action") return ActionPath.fromParts(parts);
        if (path.kind === "actionList") return { kind: "actionList", parts };
        return ConditionListPath.of(ActionPath.fromParts(parts), path.prop);
    },
};

function partsEqual(a: readonly ActionPathPart[], b: readonly ActionPathPart[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function hasPartsPrefix(
    parts: readonly (ActionPathPart | ChildConditionListName)[],
    prefix: readonly ActionPathPart[]
): boolean {
    if (parts.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (parts[i] !== prefix[i]) return false;
    }
    return true;
}
