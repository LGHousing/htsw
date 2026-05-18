import type { Action } from "htsw/types";

import type {
    ActionListOperation,
    Observed,
} from "../types";

export function actionLogLabel(action: Action | Observed<Action> | null | undefined): string {
    if (action === null || action === undefined) {
        return "Unknown Action";
    }

    if (action.type === "CONDITIONAL") {
        return "CONDITIONAL";
    }

    if (action.type === "RANDOM") {
        const ac =
            (action.actions as unknown as readonly unknown[] | undefined)?.length ?? "?";
        return `RANDOM (${ac})`;
    }

    if (action.type === "CHANGE_VAR") {
        const holder = action.holder?.type === "Global" ? "g/" : action.holder?.type === "Team" ? "t/" : "";
        return `CHANGE_VAR ${holder}${action.key ?? "?"} ${action.op ?? "="} ${action.value ?? "?"}`;
    }

    if (action.type === "MESSAGE") {
        const msg = action.message ?? "";
        const short = msg.length > 30 ? msg.slice(0, 27) + "..." : msg;
        return `MESSAGE "${short}"`;
    }

    if (action.type === "FUNCTION") {
        return `FUNCTION "${action.function ?? "?"}"`;
    }

    if (action.type === "GIVE_ITEM" || action.type === "REMOVE_ITEM" || action.type === "DROP_ITEM") {
        return `${action.type} "${action.itemName ?? "?"}"`;
    }

    if (action.type === "SET_TEAM") {
        return `SET_TEAM "${action.team ?? "None"}"`;
    }

    return action.type;
}

export function editDiffSummary(op: Extract<ActionListOperation, { kind: "edit" }>): string {
    const parts: string[] = [];
    if (op.noteDiffers) parts.push("note changed");
    for (const nested of op.nestedDiffs) {
        parts.push(`${nested.prop} ${nested.diff.operations.length} nested ops`);
    }
    return parts.length === 0 ? "fields changed" : parts.join(", ");
}
