import type { Action, Condition } from "htsw/types";

import type { ItemSlot } from "../tasks/specifics/slots";
import type { ChildConditionListName, ChildListName } from "./actionPath";
import type { ActionScalarFieldToRead } from "./actions/hydration/plan";
import { getChildListFields } from "./fields/actionMappings";

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
                            : observedNodeFromAction(entry as Observed)
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
            if (
                field.kind === "actionList" &&
                !presentChildListsContainNoNulls(entry as Observed)
            ) {
                return false;
            }
        }
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
    if (observed.type !== "CONDITIONAL" && observed.type !== "RANDOM") {
        return observed as Action;
    }

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
                ? observedActionToActionStrict(entry as Observed)
                : entry;
        });
    }
    return action as Action;
}

function observedActionToAction(observed: Observed): Action {
    if (observed.type === "CONDITIONAL") {
        return {
            type: "CONDITIONAL",
            matchAny: observed.matchAny ?? false,
            conditions: (observed.conditions ?? []).filter(
                (c): c is NonNullable<typeof c> => c !== null
            ),
            ifActions: (observed.ifActions ?? [])
                .filter((a): a is Observed => a !== null)
                .map(observedActionToAction),
            elseActions: (observed.elseActions ?? [])
                .filter((a): a is Observed => a !== null)
                .map(observedActionToAction),
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        };
    }
    if (observed.type === "RANDOM") {
        return {
            type: "RANDOM",
            actions: (observed.actions ?? [])
                .filter((a): a is Observed => a !== null)
                .map(observedActionToAction),
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        };
    }
    return observed as Action;
}
