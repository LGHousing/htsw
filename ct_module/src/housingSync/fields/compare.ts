import type { Action, Condition } from "htsw/types";
import type { Observed, UiFieldKind } from "../types";
import {
    normalizeNoteText,
    stripHousingEditorValuePrefix,
    stripRedundantLeadingFormattingCodes,
} from "./loreParsing";
import {
    getActionFieldDefault,
    getActionFieldKind,
    getActionFieldNumeric,
} from "./actionMappings";
import {
    getConditionFieldDefault,
    getConditionFieldKind,
    getConditionFieldNumeric,
} from "./conditionMappings";
import { normalizeSoundKey } from "./sounds";
import { normalizeValueTextForCompare, quantizeHousingDecimal } from "./valueText";

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
 * The diff matcher (`actions/diff.ts`) compares the same action / condition
 * objects pairwise O(n²) times — once per candidate pair across the exact,
 * note-only, and cost passes. Recomputing the canonical compare string each
 * time means re-stringifying an entire CONDITIONAL tree on every comparison,
 * which for a function with hundreds of conditionals blocks the main thread
 * for minutes (game freeze + server disconnect). Memoize the string per
 * object so each is built once. `canonicalStringify` is byte-identical to the
 * old `JSON.stringify(normalizeValue(...))`, so equality results are
 * unchanged. Objects are read-only for the duration of a diff and rebuilt
 * fresh per read, so a WeakMap keyed by identity can't go stale across diffs.
 */
const compareKeyCache = new WeakMap<object, string>();
const compareKeyNoNoteCache = new WeakMap<object, string>();

function compareKey(value: unknown): string {
    if (typeof value !== "object" || value === null) return canonicalStringify(value);
    const hit = compareKeyCache.get(value);
    if (hit !== undefined) return hit;
    const key = canonicalStringify(value);
    compareKeyCache.set(value, key);
    return key;
}

function compareKeyNoNote(value: { note?: unknown }): string {
    if (typeof value !== "object" || value === null) return canonicalStringify(value);
    const hit = compareKeyNoNoteCache.get(value);
    if (hit !== undefined) return hit;
    const key = canonicalStringify(stripNote(value));
    compareKeyNoNoteCache.set(value, key);
    return key;
}

export function actionsEqual(
    observed: Action | Observed<Action>,
    desired: Action | Observed<Action>
): boolean {
    return compareKey(observed) === compareKey(desired);
}

export function conditionsEqual(
    observed: Condition | Observed<Condition> | null,
    desired: Condition | Observed<Condition> | null
): boolean {
    return compareKey(observed) === compareKey(desired);
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
        compareKeyNoNote(desired) === compareKeyNoNote(current) &&
        desired.note !== current.note
    );
}

export function conditionOnlyNoteDiffers(
    desired: Condition,
    current: Condition | null
): boolean {
    if (current === null) return false;
    return (
        compareKeyNoNote(desired) === compareKeyNoNote(current) &&
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

function getFieldNumeric(type: string, prop: string): boolean {
    return getActionFieldNumeric(type, prop) || getConditionFieldNumeric(type, prop);
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
function shouldCoerceNumericField(type: string, prop: string): boolean {
    return getFieldNumeric(type, prop) || typeof getFieldDefault(type, prop) === "number";
}

function canonicalizeFieldValue(type: string, prop: string, value: unknown): unknown {
    if (type === "PLAY_SOUND" && prop === "sound" && typeof value === "string") {
        value = normalizeSoundKey(value) ?? value;
    }
    if (
        (type === "MESSAGE" || type === "ACTION_BAR" || type === "FAIL_PARKOUR") &&
        prop === "message" &&
        typeof value === "string"
    ) {
        value = normalizeMessageFormatting(value);
    }
    const kind = getFieldKind(type, prop);
    if (kind === "value" && shouldCoerceNumericField(type, prop)) {
        if (typeof value === "string" && value !== "") {
            const num = Number(value);
            if (Number.isFinite(num)) return quantizeHousingDecimal(num);
        } else if (typeof value === "number" && Number.isFinite(value)) {
            return quantizeHousingDecimal(value);
        }
    } else if (kind === "value" && typeof value === "string") {
        return normalizeValueTextForCompare(value);
    }
    if (kind === "location") {
        return canonicalizeLocationValue(value);
    }
    if (kind === "select" || kind === "cycle") {
        if (typeof value === "string") return { type: value };
    }
    return value;
}

function canonicalizeLocationValue(value: unknown): unknown {
    if (typeof value === "string") return { type: value };
    if (typeof value !== "object" || value === null) return value;

    const record = value as Record<string, unknown>;
    if (record.type !== "Custom Coordinates") return value;

    const normalized: Record<string, unknown> = { type: record.type };
    if (typeof record.value === "string") {
        normalized.value = normalizeCoordinateText(record.value);
    } else if (record.value !== undefined) {
        normalized.value = record.value;
    }
    return normalized;
}

function normalizeCoordinateText(value: string): string {
    return value.trim().split(/\s+/).join(" ");
}

function normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeValue(entry));
    }

    if (typeof value === "string") return value;

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
            const cachedDef = canonicalDefaultFor(recordType, key);
            if (cachedDef !== null) {
                if (cachedDef.scalar) {
                    if (fieldValue === cachedDef.value) continue;
                } else if (JSON.stringify(fieldValue) === cachedDef.json) {
                    continue;
                }
            }
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

/**
 * Emit `stableStringify(normalizeValue(value))` in a single pass, without
 * materializing the intermediate normalized object tree. Output is byte-identical
 * to the two-step form, so importable-cache hashes stay stable.
 */
export function canonicalStringify(value: unknown): string {
    if (value === null) return "null";

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
            parts.push(canonicalStringify(value[i]));
        }
        return "[" + parts.join(",") + "]";
    }

    if (typeof value === "string") return JSON.stringify(value);

    if (typeof value !== "object") {
        return JSON.stringify(value);
    }

    const record = value as Record<string, unknown>;
    const recordType = typeof record.type === "string" ? record.type : null;
    const keys = Object.keys(record).sort();

    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        let fieldValue = record[key];
        if (fieldValue === undefined) continue;

        if (recordType) {
            fieldValue = canonicalizeFieldValue(recordType, key, fieldValue);
            const cachedDef = canonicalDefaultFor(recordType, key);
            if (cachedDef !== null) {
                if (cachedDef.scalar) {
                    if (fieldValue === cachedDef.value) continue;
                } else if (JSON.stringify(fieldValue) === cachedDef.json) {
                    continue;
                }
            }
        }

        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;

        const serialized =
            key === "note" && typeof fieldValue === "string"
                ? JSON.stringify(normalizeNoteText(fieldValue))
                : canonicalStringify(fieldValue);

        parts.push(JSON.stringify(key) + ":" + serialized);
    }
    return "{" + parts.join(",") + "}";
}

// The canonicalized default for a (type, prop) is constant, but normalizeValue
// touches it for every field of every action. Cache it so the hot path does one
// stringify of the field value against a precomputed default string.
type CachedDefault = { value: unknown; json: string; scalar: boolean };
const canonicalDefaultCache = new Map<string, CachedDefault | null>();

function canonicalDefaultFor(type: string, prop: string): CachedDefault | null {
    const cacheKey = `${type} ${prop}`;
    const hit = canonicalDefaultCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const rawDefault = getFieldDefault(type, prop);
    const def = canonicalizeFieldValue(type, prop, rawDefault);
    const result: CachedDefault | null =
        def === undefined
            ? null
            : {
                  value: def,
                  json: JSON.stringify(def),
                  scalar: typeof def !== "object" || def === null,
              };
    canonicalDefaultCache.set(cacheKey, result);
    return result;
}

function normalizeMessageFormatting(value: string): string {
    return collapseRedundantFormattingCodes(
        stripRedundantLeadingFormattingCodes(stripHousingEditorValuePrefix(value))
    );
}

function collapseRedundantFormattingCodes(value: string): string {
    let color: string | null = null;
    const formats: { [code: string]: boolean } = {};
    let out = "";

    for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (ch !== "&" || i + 1 >= value.length) {
            out += ch;
            continue;
        }

        const code = value.charAt(i + 1).toLowerCase();
        if (!/[0-9a-fk-or]/.test(code)) {
            out += ch;
            continue;
        }

        if (/[0-9a-f]/.test(code)) {
            let hasFormats = false;
            for (const _key in formats) {
                hasFormats = true;
                break;
            }
            if (color !== code || hasFormats) {
                out += "&" + code;
            }
            color = code;
            for (const key in formats) {
                delete formats[key];
            }
            i++;
            continue;
        }

        if (code === "r") {
            let hasFormats = false;
            for (const _key in formats) {
                hasFormats = true;
                break;
            }
            if (color !== null || hasFormats) {
                out += "&r";
            }
            color = null;
            for (const key in formats) {
                delete formats[key];
            }
            i++;
            continue;
        }

        if (!formats[code]) {
            out += "&" + code;
            formats[code] = true;
        }
        i++;
    }

    return out;
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

function canonicalizeForCompare(type: string, prop: string, value: unknown): unknown {
    if (value === undefined) return undefined;
    const coerced = canonicalizeFieldValue(type, prop, value);
    if (
        (type === "MESSAGE" || type === "ACTION_BAR" || type === "FAIL_PARKOUR") &&
        prop === "message" &&
        typeof coerced === "string"
    ) {
        return normalizeMessageFormatting(coerced);
    }
    const def = canonicalizeFieldValue(type, prop, getFieldDefault(type, prop));
    if (def !== undefined && fieldsAreEqual(coerced, def)) return undefined;
    return normalizeValue(coerced);
}
