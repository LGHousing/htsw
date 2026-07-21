import type { Action } from "htsw/types";

import { hashHex } from "../../utils/hash";
import type { ChildListName } from "../actionPath";
import type { ObservedActionSlot } from "../observedActions";
import { getChildListFields } from "../fields/actionMappings";
import { desiredChildListTypes } from "./diff/childListMatching";

// V1 covers only action-type sequences and child-list type sequences; scalar fields and notes are excluded.
export const ACTION_LIST_SCAN_HASH_VERSION = 1;

type CanonicalChildList = {
    prop: ChildListName;
    types: readonly string[];
};

type CanonicalScanSlot =
    { unknown: true } | { type: Action["type"]; childLists?: CanonicalChildList[] };

function canonicalKnownSlot(
    type: Action["type"],
    childTypes: (prop: ChildListName) => readonly string[] | undefined
): CanonicalScanSlot {
    const childLists: CanonicalChildList[] = [];
    for (const field of getChildListFields(type)) {
        const types = childTypes(field.prop);
        if (types !== undefined && types.length > 0) {
            childLists.push({ prop: field.prop, types });
        }
    }
    return childLists.length === 0 ? { type } : { type, childLists };
}

function hashCanonicalSlots(slots: readonly CanonicalScanSlot[]): string {
    return hashHex(JSON.stringify(slots));
}

export function actionListScanHashFromSlots(
    slots: readonly ObservedActionSlot[]
): string {
    return hashCanonicalSlots(
        slots.map((slot) => {
            if (slot.action === null) return { unknown: true };
            return canonicalKnownSlot(
                slot.action.type,
                (prop) => slot.childListSummaries?.[prop]
            );
        })
    );
}

export function actionListScanHashFromActions(actions: readonly Action[]): string {
    return hashCanonicalSlots(
        actions.map((action) =>
            canonicalKnownSlot(action.type, (prop) => desiredChildListTypes(action, prop))
        )
    );
}
