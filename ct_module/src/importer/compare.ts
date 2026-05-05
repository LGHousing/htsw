import type { Action, Condition } from "htsw/types";
import type {
    ActionListOperation,
    Observed,
    ScalarFieldDiff,
    UiFieldKind,
} from "./types";
import { normalizeNoteText } from "./loreParsing";
import {
    getActionFieldDefault,
    getActionFieldKind,
    getActionScalarLoreFields,
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

const INTEGER_DISPLAY_VALUE_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)$/;
const DECIMAL_DISPLAY_VALUE_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)\.\d+$/;

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

/**
 * Per-field comparison used by the diff engine and the edit-log
 * renderer. Returns the list of fields that differ post-normalization,
 * with the canonical observed/desired values. Centralising this means
 * the cost calculation, the equality check, and the human-readable
 * EDIT log all agree on what counts as a real change.
 */
export function diffScalarFields(
    observed: Record<string, unknown>,
    desired: Record<string, unknown>,
    type: string,
    scalarProps: ReadonlyArray<{ prop: string; kind: UiFieldKind }>
): ScalarFieldDiff[] {
    const out: ScalarFieldDiff[] = [];
    for (const { prop, kind } of scalarProps) {
        const obsCanonical = canonicalizeForCompare(type, prop, observed[prop]);
        const desCanonical = canonicalizeForCompare(type, prop, desired[prop]);
        if (!fieldsAreEqual(obsCanonical, desCanonical)) {
            out.push({ prop, kind, observed: observed[prop], desired: desired[prop] });
        }
    }
    return out;
}

/**
 * Per-edit-op verdict used by the edit-log renderer and any other
 * consumer (telemetry, replay logs, the right-panel diff sink) that
 * needs to know which fields the engine considers different. Reuses
 * the same normalized comparison the engine uses to emit the op, so
 * callers can't drift from the engine's truth.
 */
export function getEditFieldDiffs(
    op: Extract<ActionListOperation, { kind: "edit" }>
): { fieldDiffs: ScalarFieldDiff[]; noteDiffers: boolean } {
    const action = op.observed.action;
    if (action === null) {
        return { fieldDiffs: [], noteDiffers: false };
    }
    const fieldDiffs = op.noteOnly
        ? []
        : diffScalarFields(
              action,
              op.desired,
              action.type,
              getActionScalarLoreFields(action.type)
          );
    return { fieldDiffs, noteDiffers: action.note !== op.desired.note };
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
