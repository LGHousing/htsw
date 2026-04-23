import type { Action, Condition } from "htsw/types";
import type { Observed } from "./actions/types";
import { normalizeNoteText } from "./helpers";

// Sad
export function normalizeConditionCompare(
    value: Condition | Observed<Condition> | null
): Condition | Observed<Condition> | null {
    return normalizeValue(value) as Condition | Observed<Condition> | null;
}

export function normalizeActionCompare(
    value: Action | Observed<Action>
): Action | Observed<Action> {
    return normalizeValue(value) as Action | Observed<Action>;
}

function normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        const fieldValue = record[key];
        if (fieldValue === undefined) continue;
        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;
        normalized[key] =
            key === "note" && typeof fieldValue === "string"
                ? normalizeNoteText(fieldValue)
                : normalizeValue(fieldValue);
    }

    return normalized;
}
