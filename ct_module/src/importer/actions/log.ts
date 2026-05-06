import type { Action } from "htsw/types";

import { getEditFieldDiffs } from "../compare";
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

export function shortVal(v: unknown): string {
    if (v === undefined) return "unset";
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") {
        const quoted = `"${v}"`;
        return quoted.length > 35 ? `"${v.slice(0, 30)}..."` : quoted;
    }
    if (typeof v === "object") {
        const json = JSON.stringify(v);
        return json.length > 35 ? json.slice(0, 32) + "..." : json;
    }
    const s = String(v);
    return s.length > 35 ? s.slice(0, 32) + "..." : s;
}

export function editDiffSummary(op: Extract<ActionListOperation, { kind: "edit" }>): string {
    const { fieldDiffs, noteDiffers } = getEditFieldDiffs(op);
    const parts: string[] = [];
    for (const diff of fieldDiffs) {
        parts.push(`${diff.prop} ${shortVal(diff.observed)} -> ${shortVal(diff.desired)}`);
    }
    if (noteDiffers) parts.push("note changed");
    return parts.join(", ");
}
