import type { Action, Condition } from "htsw/types";

import { hashHex } from "../../utils/hash";
import type { ChildListName } from "../actionPath";
import type { ObservedActionSlot } from "../observedActions";
import {
    getActionScalarLoreFields,
    getChildListFields,
} from "../fields/actionMappings";
import { getConditionScalarLoreFields } from "../fields/conditionMappings";
import { desiredChildListTypes } from "./diff/childListMatching";
import { fullyHydratedActionsFromSlots } from "./hydration/plan";
import { noteCompareKey, scalarFieldCompareKey } from "./comparison";
import type { ItemFieldContent } from "../items/fieldContent";

// V1 covers only action-type sequences and child-list type sequences; scalar fields and notes are excluded.
export const ACTION_LIST_SCAN_HASH_VERSION = 2;
export const ACTION_LIST_CONTENT_HASH_VERSION = 5;

type CanonicalChildList = {
    prop: ChildListName;
    types: readonly string[];
};

export type CanonicalScanSlot =
    { unknown: true } | { type: Action["type"]; childLists?: CanonicalChildList[] };

function canonicalKnownSlot(
    type: Action["type"],
    childTypes: (prop: ChildListName) => readonly string[] | undefined
): CanonicalScanSlot {
    const childLists: CanonicalChildList[] = [];
    for (const field of getChildListFields(type)) {
        const types = childTypes(field.prop);
        if (types !== undefined && types.length > 0) {
            childLists.push({
                prop: field.prop,
                types:
                    field.kind === "conditionList" ? [...types].sort() : types,
            });
        }
    }
    return childLists.length === 0 ? { type } : { type, childLists };
}

function hashCanonicalSlots(slots: readonly CanonicalScanSlot[]): string {
    return hashHex(JSON.stringify(slots));
}

export function actionListScanSlotsFromSlots(
    slots: readonly ObservedActionSlot[]
): CanonicalScanSlot[] {
    return slots.map((slot) => {
        if (slot.action === null) return { unknown: true };
        return canonicalKnownSlot(
            slot.action.type,
            (prop) => slot.childListSummaries?.[prop]
        );
    });
}

export function actionListScanSlotsFromActions(
    actions: readonly Action[]
): CanonicalScanSlot[] {
    return actions.map((action) =>
        canonicalKnownSlot(action.type, (prop) => desiredChildListTypes(action, prop))
    );
}

export function actionListScanHashFromSlots(
    slots: readonly ObservedActionSlot[]
): string {
    return hashCanonicalSlots(actionListScanSlotsFromSlots(slots));
}

export function actionListScanHashFromActions(actions: readonly Action[]): string {
    return hashCanonicalSlots(actionListScanSlotsFromActions(actions));
}

function stableJson(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) => {
        if (
            entry === null ||
            typeof entry !== "object" ||
            Array.isArray(entry)
        ) {
            return entry;
        }
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(entry).sort();
        for (const key of keys) {
            sorted[key] = (entry as Record<string, unknown>)[key];
        }
        return sorted;
    });
}

function canonicalScalarContent(
    value: Record<string, unknown>,
    type: string,
    fields: readonly { prop: string; kind?: string }[],
    itemContent?: ItemFieldContent
): Record<string, unknown> {
    const canonical: Record<string, unknown> = { type };
    for (const field of fields) {
        if (field.kind === "item") {
            const item = itemContent?.(
                value as unknown as Action | Condition,
                field.prop
            );
            if (item !== undefined) canonical[field.prop] = item;
            continue;
        }
        const key = scalarFieldCompareKey(type, field.prop, value[field.prop]);
        if (key !== undefined) canonical[field.prop] = key;
    }
    const note = noteCompareKey(
        typeof value.note === "string" ? value.note : undefined
    );
    if (note !== undefined) canonical.note = note;
    return canonical;
}

function canonicalConditionContent(
    condition: Condition,
    itemContent?: ItemFieldContent
): Record<string, unknown> {
    const value = condition as unknown as Record<string, unknown>;
    const canonical = canonicalScalarContent(
        value,
        condition.type,
        getConditionScalarLoreFields(condition.type),
        itemContent
    );
    if (condition.inverted !== undefined) {
        canonical.inverted = condition.inverted;
    }
    return canonical;
}

function canonicalActionContent(
    action: Action,
    includeChildLists: boolean,
    itemContent?: ItemFieldContent
): Record<string, unknown> {
    const value = action as unknown as Record<string, unknown>;
    const canonical = canonicalScalarContent(
        value,
        action.type,
        getActionScalarLoreFields(action.type),
        itemContent
    );
    if (!includeChildLists) return canonical;

    for (const field of getChildListFields(action.type)) {
        const childList = value[field.prop];
        if (!Array.isArray(childList) || childList.length === 0) continue;
        if (field.kind === "conditionList") {
            canonical[field.prop] = (childList as Condition[])
                .map((condition) => canonicalConditionContent(condition, itemContent))
                .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
        } else {
            canonical[field.prop] = (childList as Action[]).map((child) =>
                canonicalActionContent(child, false, itemContent)
            );
        }
    }
    return canonical;
}

export function actionListContentHashFromActions(
    actions: readonly Action[],
    itemContent?: ItemFieldContent
): string {
    return hashHex(
        stableJson(
            actions.map((action) =>
                canonicalActionContent(action, true, itemContent)
            )
        )
    );
}

export function actionListContentHashFromSlots(
    slots: readonly ObservedActionSlot[],
    itemContent?: ItemFieldContent
): string | undefined {
    const actions = fullyHydratedActionsFromSlots(slots);
    return actions === null
        ? undefined
        : actionListContentHashFromActions(actions, itemContent);
}
