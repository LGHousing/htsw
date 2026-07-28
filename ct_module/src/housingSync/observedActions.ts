import type { Action, Condition } from "htsw/types";

import type { ItemSlot } from "../tasks/specifics/slots";
import type { ChildConditionListName, ChildListName } from "./actionPath";
import type { ActionScalarFieldToRead } from "./actions/hydration/plan";
import { getChildListFields } from "./fields/actionMappings";
import { isChildAction, type ChildAction } from "./actions/childActions";

type ObservedFields<T extends Action | Condition> = {
    [K in keyof Omit<T, "type">]?: T[K] extends Action[]
        ? Array<Observed | null>
        : T[K] extends Condition[]
          ? Array<Condition | null>
          : T[K];
};

export type Observed<T extends Action | Condition = Action> = T extends Action | Condition
    ? Pick<T, "type"> & ObservedFields<T>
    : never;

type ChildListEntryType<K extends ChildListName> = K extends ChildConditionListName
    ? Condition["type"]
    : Action["type"];

export type ChildListSummaries = {
    [K in ChildListName]?: Array<ChildListEntryType<K> | "UNKNOWN">;
};

/** Child list properties that still need to be read by clicking in. */
export type ChildListsToRead = Set<ChildListName>;

export type ObservedActionSlot = {
    index: number;
    slotId?: number;
    slot?: ItemSlot;
    action: Observed | null;
    hydrated: boolean;
    truncatedFields: readonly ActionScalarFieldToRead[];
    childListSummaries?: ChildListSummaries;
    childListsToRead?: ChildListsToRead;
};

export type ObservedConditionSlot = {
    index: number;
    slotId?: number;
    slot?: ItemSlot;
    condition: Condition | null;
};

export type ObservedNode =
    | { kind: "unknown" }
    | { kind: "action"; action: Action }
    | {
          kind: "partial";
          type: Action["type"];
          action: Observed;
          childLists: Partial<Record<ChildListName, ObservedChildList>>;
      };

export type ObservedChildList =
    | { state: "summary"; types: readonly string[] }
    | { state: "conditions"; entries: ReadonlyArray<Condition | null> }
    | { state: "actions"; entries: readonly ObservedNode[] };

export function observedNodesFromSlots(
    slots: readonly ObservedActionSlot[]
): ObservedNode[] {
    return slots.map((slot) => {
        if (slot.action === null) return { kind: "unknown" };
        return observedNodeFromAction(
            slot.action,
            slot.childListSummaries,
            slot.childListsToRead
        );
    });
}

function observedNodeFromAction(
    action: Observed,
    summaries?: ChildListSummaries,
    childListsToRead?: ChildListsToRead
): ObservedNode {
    const fields = getChildListFields(action.type);
    let unresolved = childListsToRead !== undefined && childListsToRead.size > 0;
    for (const field of fields) {
        const value = (action as Record<string, unknown>)[field.prop];
        if (Array.isArray(value) && value.some((entry) => entry === null)) {
            unresolved = true;
        }
    }

    if (!unresolved) {
        return { kind: "action", action: action as Action };
    }

    const childLists: Partial<Record<ChildListName, ObservedChildList>> = {};
    for (const field of fields) {
        const value = (action as Record<string, unknown>)[field.prop];
        const entries = Array.isArray(value) ? value : undefined;
        const hasKnownEntry = entries?.some((entry) => entry !== null) === true;

        if (entries !== undefined && (entries.length === 0 || hasKnownEntry)) {
            if (field.kind === "conditionList") {
                childLists[field.prop] = {
                    state: "conditions",
                    entries: entries as ReadonlyArray<Condition | null>,
                };
            } else {
                childLists[field.prop] = {
                    state: "actions",
                    entries: entries.map((entry) =>
                        entry === null
                            ? { kind: "unknown" }
                            : observedNodeFromChildAction(entry as Observed)
                    ),
                };
            }
            continue;
        }

        const summary = summaries?.[field.prop];
        if (summary !== undefined) {
            childLists[field.prop] = { state: "summary", types: summary };
        }
    }

    return { kind: "partial", type: action.type, action, childLists };
}

function observedNodeFromChildAction(action: Observed): ObservedNode {
    if (!isChildAction(action)) {
        throw new Error(
            `${action.type} action cannot appear inside an action child list.`
        );
    }
    const fields = getChildListFields(action.type);
    let unresolved = false;
    const childLists: Partial<Record<ChildListName, ObservedChildList>> = {};
    for (const field of fields) {
        if (field.kind === "actionList") {
            throw new Error(
                `Action child list "${field.prop}" reached a child action.`
            );
        }
        const value = (action as Record<string, unknown>)[field.prop];
        if (!Array.isArray(value)) continue;
        if (value.some((entry) => entry === null)) unresolved = true;
        childLists[field.prop] = {
            state: "conditions",
            entries: value as ReadonlyArray<Condition | null>,
        };
    }
    return unresolved
        ? { kind: "partial", type: action.type, action, childLists }
        : { kind: "action", action: action as Action };
}

export function observedSlotsToActions(slots: readonly ObservedActionSlot[]): Action[] {
    const result: Action[] = [];
    for (const slot of slots) {
        if (slot.action === null) continue;
        result.push(observedActionToAction(slot.action));
    }
    return result;
}

export function presentChildListsContainNoNulls(action: Observed): boolean {
    for (const field of getChildListFields(action.type)) {
        const value = (action as Record<string, unknown>)[field.prop];
        if (!Array.isArray(value)) continue;
        for (const entry of value) {
            if (entry === null) return false;
            if (field.kind === "actionList") {
                if (!isChildAction(entry as Observed)) return false;
                if (!presentChildConditionListsContainNoNulls(entry as Observed)) {
                    return false;
                }
            }
        }
    }
    return true;
}

function presentChildConditionListsContainNoNulls(action: Observed): boolean {
    for (const field of getChildListFields(action.type)) {
        if (field.kind === "actionList") return false;
        const value = (action as Record<string, unknown>)[field.prop];
        if (!Array.isArray(value)) continue;
        if (value.some((entry) => entry === null)) return false;
    }
    return true;
}

export function fullyHydratedObservedSlotsToActions(
    slots: readonly ObservedActionSlot[]
): Action[] {
    return slots.map((slot) => {
        if (slot.action === null) {
            throw new Error("A hydrated action slot has no parsed action.");
        }
        return observedActionToActionStrict(slot.action);
    });
}

function observedActionToActionStrict(observed: Observed): Action {
    const action = { ...observed } as Record<string, unknown>;
    for (const field of getChildListFields(observed.type)) {
        const value = action[field.prop];
        if (!Array.isArray(value)) {
            throw new Error(
                `Hydrated action "${observed.type}" is missing child list "${field.prop}".`
            );
        }
        const entries = value as unknown[];
        action[field.prop] = entries.map((entry) => {
            if (entry === null) {
                throw new Error(
                    `Hydrated action "${observed.type}" has an unread entry in "${field.prop}".`
                );
            }
            return field.kind === "actionList"
                ? observedChildActionToActionStrict(entry as Observed)
                : entry;
        });
    }
    return action as Action;
}

function observedChildActionToActionStrict(observed: Observed): ChildAction {
    if (!isChildAction(observed)) {
        throw new Error(
            `${observed.type} action cannot appear inside an action child list.`
        );
    }
    const action = { ...observed } as Record<string, unknown>;
    for (const field of getChildListFields(observed.type)) {
        if (field.kind === "actionList") {
            throw new Error(
                `Action child list "${field.prop}" reached a child action.`
            );
        }
        const value = action[field.prop];
        if (!Array.isArray(value)) {
            throw new Error(
                `Hydrated action "${observed.type}" is missing child list "${field.prop}".`
            );
        }
        if (value.some((entry) => entry === null)) {
            throw new Error(
                `Hydrated action "${observed.type}" has an unread entry in "${field.prop}".`
            );
        }
    }
    return action as ChildAction;
}

function observedActionToAction(observed: Observed): Action {
    const action = { ...observed } as Record<string, unknown>;
    if (observed.type === "CONDITIONAL" && observed.matchAny === undefined) {
        action.matchAny = false;
    }
    for (const field of getChildListFields(observed.type)) {
        const value = action[field.prop];
        const entries = Array.isArray(value) ? value : [];
        action[field.prop] =
            field.kind === "actionList"
                ? entries
                      .filter((entry): entry is Observed => entry !== null)
                      .map(observedChildActionToAction)
                : entries.filter((entry) => entry !== null);
    }
    return action as Action;
}

function observedChildActionToAction(observed: Observed): ChildAction {
    if (!isChildAction(observed)) {
        throw new Error(
            `${observed.type} action cannot appear inside an action child list.`
        );
    }
    return observed as ChildAction;
}
