import type { Action, Condition } from "htsw/types";
import type { Observed, UiFieldKind } from "./types";
import {
    DECIMAL_DISPLAY_VALUE_PATTERN,
    INTEGER_DISPLAY_VALUE_PATTERN,
    normalizeNoteText,
} from "./loreParsing";
import {
    getActionFieldDefault,
    getActionFieldKind,
} from "./actionMappings";
import { getConditionFieldDefault, getConditionFieldKind } from "./conditionMappings";

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

export function actionsEqual(
    observed: Action | Observed<Action>,
    desired: Action | Observed<Action>
): boolean {
    return (
        JSON.stringify(normalizeActionCompare(observed)) ===
        JSON.stringify(normalizeActionCompare(desired))
    );
}

export function conditionsEqual(
    observed: Condition | Observed<Condition> | null,
    desired: Condition | Observed<Condition> | null
): boolean {
    return (
        JSON.stringify(normalizeConditionCompare(observed)) ===
        JSON.stringify(normalizeConditionCompare(desired))
    );
}

function stripNote<T extends { note?: unknown }>(value: T): T {
    const { note: _note, ...rest } = value;
    return rest as T;
}

export function actionOnlyNoteDiffers(
    desired: Action,
    current: Action | Observed<Action>
): boolean {
    return (
        desired.type === current.type &&
        JSON.stringify(normalizeActionCompare(stripNote(desired))) ===
            JSON.stringify(normalizeActionCompare(stripNote(current))) &&
        desired.note !== current.note
    );
}

export function conditionOnlyNoteDiffers(
    desired: Condition,
    current: Condition | null
): boolean {
    if (current === null) return false;
    return (
        JSON.stringify(normalizeConditionCompare(stripNote(desired))) ===
            JSON.stringify(normalizeConditionCompare(stripNote(current))) &&
        desired.note !== current.note
    );
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

function getFieldKind(type: string, prop: string): UiFieldKind | undefined {
    return getActionFieldKind(type, prop) ?? getConditionFieldKind(type, prop);
}

/**
 * Bring an action/condition field value into a canonical form so the
 * lore-parsed observed side compares equal to the source-parsed desired
 * side. Resolves two shape mismatches inherent to lore vs source:
 *
 *   - "value" fields with numeric defaults: lore parsing produces strings,
 *     source parsing produces numbers. Coerce parseable numeric strings to
 *     numbers when the field's default is numeric.
 *   - "select"/"cycle" fields: source produces `{ type: <label> }`, lore
 *     produces a bare string. Wrap bare strings into `{ type }` so both
 *     sides land on the object form.
 */
function canonicalizeFieldValue(
    type: string,
    prop: string,
    value: unknown
): unknown {
    const kind = getFieldKind(type, prop);
    if (kind === "value") {
        const def = getFieldDefault(type, prop);
        if (typeof def === "number" && typeof value === "string") {
            const num = Number(value);
            if (Number.isFinite(num)) return num;
        }
    }
    if (kind === "select" || kind === "cycle") {
        if (typeof value === "string") return { type: value };
    }
    return value;
}

function normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }

    if (typeof value === "string") {
        return normalizeComparableString(value);
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    const record = value as Record<string, unknown>;
    const recordType = typeof record.type === "string" ? record.type : null;

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        let fieldValue = record[key];
        if (fieldValue === undefined) continue;

        if (recordType) {
            fieldValue = canonicalizeFieldValue(recordType, key, fieldValue);
            const def = canonicalizeFieldValue(
                recordType,
                key,
                getFieldDefault(recordType, key)
            );
            if (def !== undefined && fieldsAreEqual(fieldValue, def)) continue;
        }

        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;
        normalized[key] =
            key === "note" && typeof fieldValue === "string"
                ? normalizeNoteText(fieldValue)
                : normalizeValue(fieldValue);
    }

    return normalized;
}

function fieldsAreEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeComparableString(value: string): string {
    const isIntegerDisplay = INTEGER_DISPLAY_VALUE_PATTERN.test(value);
    const isDecimalDisplay = DECIMAL_DISPLAY_VALUE_PATTERN.test(value);
    if (!isIntegerDisplay && !isDecimalDisplay) return value;

    const withoutCommas = value.replace(/,/g, "");
    const numericValue = Number(withoutCommas);
    if (!Number.isFinite(numericValue)) {
        return value;
    }

    const normalized = Object.is(numericValue, -0) ? "0" : String(numericValue);
    if (isDecimalDisplay && !normalized.includes(".")) {
        return `${normalized}.0`;
    }

    return normalized;
}

export function scalarFieldDiffers(
    observed: Record<string, unknown>,
    desired: Record<string, unknown>,
    type: string,
    prop: string
): boolean {
    const obsCanonical = canonicalizeForCompare(type, prop, observed[prop]);
    const desCanonical = canonicalizeForCompare(type, prop, desired[prop]);
    return !fieldsAreEqual(obsCanonical, desCanonical);
}

function canonicalizeForCompare(
    type: string,
    prop: string,
    value: unknown
): unknown {
    if (value === undefined) return undefined;
    const coerced = canonicalizeFieldValue(type, prop, value);
    const def = canonicalizeFieldValue(type, prop, getFieldDefault(type, prop));
    if (def !== undefined && fieldsAreEqual(coerced, def)) return undefined;
    return normalizeValue(coerced);
}
