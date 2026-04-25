import type { Action, Condition } from "htsw/types";
import type { Observed } from "./types";
import { normalizeNoteText } from "./loreParsing";
import { getActionFieldDefault } from "./actionMappings";
import { getConditionFieldDefault } from "./conditionMappings";

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

/**
 * Returns the GUI default for a (type, prop) on either an action or a
 * condition, or undefined if no default applies. Action and condition
 * type names are disjoint, so trying action first then condition gives
 * the right answer for both.
 */
function getFieldDefault(type: string, prop: string): unknown {
    const actionDefault = getActionFieldDefault(type, prop);
    if (actionDefault !== undefined) return actionDefault;
    return getConditionFieldDefault(type, prop);
}

function normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    const record = value as Record<string, unknown>;
    const recordType = typeof record.type === "string" ? record.type : null;

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        const fieldValue = record[key];
        if (fieldValue === undefined) continue;
        // Drop GUI-default values so an observed action that read the
        // default-valued field matches a desired action where the field
        // was omitted in source. Defaults live in the lore field spec.
        if (recordType && fieldValue === getFieldDefault(recordType, key)) continue;
        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;
        normalized[key] =
            key === "note" && typeof fieldValue === "string"
                ? normalizeNoteText(fieldValue)
                : normalizeValue(fieldValue);
    }

    return normalized;
}
