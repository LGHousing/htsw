import type { Action } from "htsw/types";

import { getChildListFields } from "../fields/actionMappings";
import type { Observed } from "../observedActions";
import type { ChildAction } from "./actionStructure";

export type {
    ChildAction,
    RootAction,
} from "./actionStructure";

export function isChildAction(
    action: Action | Observed
): action is ChildAction | Observed<ChildAction> {
    return !getChildListFields(action.type).some(
        (field) => field.kind === "actionList"
    );
}

export function assertOneLevelActionTree(
    actions: ReadonlyArray<Action | Observed | null>
): void {
    for (const action of actions) {
        if (action === null) continue;
        for (const field of getChildListFields(action.type)) {
            if (field.kind !== "actionList") continue;
            const children = (
                action as unknown as Record<string, unknown>
            )[field.prop];
            if (!Array.isArray(children)) continue;
            for (const child of children as Array<Action | Observed | null>) {
                if (child !== null && !isChildAction(child)) {
                    throw new Error(
                        `${child.type} action cannot appear inside an action child list.`
                    );
                }
            }
        }
    }
}
