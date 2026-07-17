import type { Action } from "htsw/types";

import type { ChildListName } from "../../actionPath";
import {
    getActionLoreFields,
    getActionScalarLoreFields,
    getChildListFields,
} from "../../fields/actionMappings";
import type { UiFieldKind } from "../../fields/loreSpecs";
import { isTruncatableKind, looksTruncated } from "../../fields/loreParsing";
import type {
    ChildListsToRead,
    Observed,
    ObservedActionSlot,
} from "../../observedActions";
import { fullyHydratedObservedSlotsToActions } from "../../observedActions";
import type { DesiredActionEntry } from "../diff/childListMatching";

export type ActionScalarFieldToRead = {
    label: string;
    prop: string;
    kind: UiFieldKind;
};

type ActionItemFieldToCapture = {
    label: string;
    prop: string;
};

export type ActionHydrationWork = {
    childListsToRead: ChildListsToRead;
    scalarFieldsToRead: ActionScalarFieldToRead[];
    itemFieldsToCapture: ActionItemFieldToCapture[];
};

export type ActionHydrationPlan = Map<ObservedActionSlot, ActionHydrationWork>;

function createActionHydrationWork(
    childListsToRead: ChildListsToRead = new Set()
): ActionHydrationWork {
    return {
        childListsToRead,
        scalarFieldsToRead: [],
        itemFieldsToCapture: [],
    };
}

function ensureActionHydrationWork(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot
): ActionHydrationWork {
    let work = plan.get(entry);
    if (work === undefined) {
        work = createActionHydrationWork();
        plan.set(entry, work);
    }
    return work;
}

export function actionHydrationWorkRequiresHousing(work: ActionHydrationWork): boolean {
    return (
        work.childListsToRead.size > 0 ||
        work.scalarFieldsToRead.length > 0 ||
        work.itemFieldsToCapture.length > 0
    );
}

function addScalarFieldsToRead(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot,
    fields: readonly ActionScalarFieldToRead[]
): void {
    if (fields.length === 0) return;
    const work = ensureActionHydrationWork(plan, entry);
    work.scalarFieldsToRead = fields.slice();
}

function addItemFieldsToCapture(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot,
    fields: ActionItemFieldToCapture[]
): void {
    if (fields.length === 0) return;
    const work = ensureActionHydrationWork(plan, entry);
    work.itemFieldsToCapture = fields;
}

export function createActionHydrationPlan(
    matches: Map<ObservedActionSlot, DesiredActionEntry>
): ActionHydrationPlan {
    const plan: ActionHydrationPlan = new Map();
    for (const observed of matches.keys()) {
        const childListsToRead = getChildListsNeedingHydration(observed);
        if (childListsToRead.size > 0) {
            plan.set(observed, createActionHydrationWork(childListsToRead));
        }
    }
    return plan;
}

function getChildListsNeedingHydration(entry: ObservedActionSlot): ChildListsToRead {
    if (entry.childListsToRead !== undefined) {
        return new Set(entry.childListsToRead);
    }

    const childLists: ChildListsToRead = new Set();
    if (entry.action === null) return childLists;

    for (const field of getChildListFields(entry.action.type)) {
        const prop = field.prop as ChildListName;
        if ((entry.childListSummaries?.[prop] ?? []).length > 0) {
            childLists.add(prop);
        }
    }
    return childLists;
}

export function addScalarHydrationEntries(
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null) continue;

        addScalarFieldsToRead(plan, entry, entry.truncatedFields);
    }
}

function getItemFieldsForCapture(
    actionType: Action["type"]
): Array<{ label: string; prop: string }> {
    const loreFields = getActionLoreFields(actionType);
    const result: Array<{ label: string; prop: string }> = [];
    for (const label in loreFields) {
        if (loreFields[label].kind === "item") {
            result.push({ label: label, prop: loreFields[label].prop });
        }
    }
    return result;
}

export function actionHasItemFieldsToCapture(actionType: Action["type"]): boolean {
    return getItemFieldsForCapture(actionType).length > 0;
}

export function addItemCaptureEntries(
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null) continue;
        addItemFieldsToCapture(plan, entry, getItemFieldsForCapture(entry.action.type));
    }
}

export function scalarFieldsNeedingHydration(
    action: Observed<Action>
): ActionScalarFieldToRead[] {
    const fields = getActionScalarLoreFields(action.type);
    const out: ActionScalarFieldToRead[] = [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!isTruncatableKind(field.kind)) continue;
        const value = (action as Record<string, unknown>)[field.prop];
        if (typeof value === "string" && looksTruncated(value)) {
            out.push(field);
            continue;
        }
        if (
            field.kind === "location" &&
            typeof value === "object" &&
            value !== null &&
            (value as { type?: unknown }).type === "Custom Coordinates"
        ) {
            const coord = (value as { value?: unknown }).value;
            if (typeof coord === "string" && looksTruncated(coord)) {
                out.push(field);
            }
        }
    }
    if (action.type === "CHANGE_VAR" && action.holder?.type === "Team") {
        const team = action.holder.team;
        if (typeof team === "string" && looksTruncated(team)) {
            for (let i = 0; i < fields.length; i++) {
                if (fields[i].prop === "holder") {
                    out.push(fields[i]);
                    break;
                }
            }
        }
    }
    return out;
}

export function buildFullHydrationPlan(
    observed: readonly ObservedActionSlot[]
): ActionHydrationPlan {
    const plan: ActionHydrationPlan = new Map();
    for (const entry of observed) {
        if (entry.childListsToRead && entry.childListsToRead.size > 0) {
            plan.set(entry, createActionHydrationWork(entry.childListsToRead));
        }
    }
    return plan;
}

export function actionsFullyHydrated(
    actions: ReadonlyArray<Action | Observed<Action> | null>
): boolean {
    for (const action of actions) {
        if (action === null) return false;
        for (const field of getChildListFields(action.type)) {
            const childList = (action as Record<string, unknown>)[field.prop];
            if (!Array.isArray(childList)) return false;
            if (field.prop === "conditions") {
                for (const condition of childList) {
                    if (condition === null) return false;
                }
            } else if (!actionsFullyHydrated(childList as Array<Action | null>)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Observed slots as a plain action list, or null when any slot or child list
 * is still unhydrated (persisting one would cache a half-known list as truth).
 */
export function fullyHydratedActionsFromSlots(
    slots: readonly ObservedActionSlot[]
): Action[] | null {
    if (slots.some((slot) => !slot.hydrated)) return null;
    return fullyHydratedObservedSlotsToActions(slots);
}
