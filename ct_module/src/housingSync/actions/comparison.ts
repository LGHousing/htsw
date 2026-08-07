import type { Action, Condition } from "htsw/types";
import { stableStringify } from "../../utils/helpers";
import type { Observed } from "../observedActions";
import type { UiFieldKind } from "../fields/loreSpecs";
import {
    DECIMAL_DISPLAY_VALUE_PATTERN,
    INTEGER_DISPLAY_VALUE_PATTERN,
    normalizeNoteText,
    stripHousingEditorValuePrefix,
    stripRedundantLeadingFormattingCodes,
} from "../fields/loreParsing";
import {
    getActionFieldDefault,
    getActionFieldKind,
    getActionFieldNumeric,
} from "../fields/actionMappings";
import {
    getConditionFieldDefault,
    getConditionFieldKind,
    getConditionFieldNumeric,
} from "../fields/conditionMappings";
import { normalizeSoundKey } from "../fields/sounds";
import { canonicalVanillaItemCompareName } from "../items/itemReferences";

const doubleBits = new DataView(new ArrayBuffer(8));

function decimalDigitsForJava(value: number): { digits: string; decimalAt: number } {
    const source = String(value);
    const exponentAt = source.search(/[eE]/);
    const coefficient = exponentAt === -1 ? source : source.substring(0, exponentAt);
    const exponent = exponentAt === -1 ? 0 : Number(source.substring(exponentAt + 1));
    const pointAt = coefficient.indexOf(".");
    const decimalAt = pointAt === -1 ? coefficient.length : pointAt;
    const untrimmed = coefficient.replace(".", "");
    const firstNonzero = untrimmed.search(/[1-9]/);
    let digits = firstNonzero === -1 ? "" : untrimmed.substring(firstNonzero);
    if ((value < 0.001 || value >= 1e7) && digits.length === 1) digits += "0";
    return { digits, decimalAt: decimalAt - firstNonzero + exponent };
}

function compareShortestDecimalToDouble(
    digits: string,
    decimalAt: number,
    value: number
): number {
    doubleBits.setFloat64(0, value, false);
    const high = doubleBits.getUint32(0, false);
    const low = doubleBits.getUint32(4, false);
    const exponentBits = (high >>> 20) & 0x7ff;
    const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    const mantissa = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
    const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1075;
    const decimalExponent = decimalAt - digits.length;

    let decimalNumerator = BigInt(digits);
    let decimalDenominator = 1n;
    if (decimalExponent >= 0) {
        decimalNumerator *= 10n ** BigInt(decimalExponent);
    } else {
        decimalDenominator = 10n ** BigInt(-decimalExponent);
    }

    let binaryNumerator = mantissa;
    let binaryDenominator = 1n;
    if (binaryExponent >= 0) {
        binaryNumerator <<= BigInt(binaryExponent);
    } else {
        binaryDenominator <<= BigInt(-binaryExponent);
    }

    const decimalScaled = decimalNumerator * binaryDenominator;
    const binaryScaled = binaryNumerator * decimalDenominator;
    return decimalScaled < binaryScaled ? -1 : decimalScaled > binaryScaled ? 1 : 0;
}

function javaHalfEvenRoundsUp(
    digits: string,
    maximumDigits: number,
    alreadyRounded: boolean,
    valueExactAsDecimal: boolean
): boolean {
    const roundingDigit = digits.charAt(maximumDigits);
    if (roundingDigit > "5") return true;
    if (roundingDigit < "5") return false;
    if (maximumDigits === digits.length - 1) {
        if (alreadyRounded) return false;
        if (!valueExactAsDecimal) return true;
        return maximumDigits > 0 && Number(digits.charAt(maximumDigits - 1)) % 2 !== 0;
    }
    for (let i = maximumDigits + 1; i < digits.length; i++) {
        if (digits.charAt(i) !== "0") return true;
    }
    return false;
}

function roundedJavaDecimalValue(digits: string, decimalAt: number): number {
    if (digits === "") return 0;
    return Number(`${digits}e${decimalAt - digits.length}`);
}

function quantizeHousingDecimal(num: number): number {
    if (Math.floor(num) === num) return num;
    const magnitude = Math.abs(num);
    let { digits, decimalAt } = decimalDigitsForJava(magnitude);
    const decimalComparison = compareShortestDecimalToDouble(
        digits,
        decimalAt,
        magnitude
    );
    const alreadyRounded = decimalComparison > 0;
    const valueExactAsDecimal = decimalComparison === 0;

    if (-decimalAt > 3) return num < 0 ? -0 : 0;
    if (-decimalAt === 3) {
        const roundsUp = javaHalfEvenRoundsUp(
            digits,
            0,
            alreadyRounded,
            valueExactAsDecimal
        );
        return roundsUp ? (num < 0 ? -0.001 : 0.001) : num < 0 ? -0 : 0;
    }

    while (digits.length > 1 && digits.charAt(digits.length - 1) === "0") {
        digits = digits.substring(0, digits.length - 1);
    }
    const maximumDigits = 3 + decimalAt;
    if (maximumDigits >= 0 && maximumDigits < digits.length) {
        if (
            javaHalfEvenRoundsUp(
                digits,
                maximumDigits,
                alreadyRounded,
                valueExactAsDecimal
            )
        ) {
            const kept = digits.substring(0, maximumDigits);
            const incremented = (kept === "" ? 0n : BigInt(kept)) + 1n;
            const incrementedDigits = String(incremented);
            if (incrementedDigits.length > maximumDigits) decimalAt++;
            digits = incrementedDigits;
        } else {
            digits = digits.substring(0, maximumDigits);
        }
    }

    const rounded = roundedJavaDecimalValue(digits, decimalAt);
    return num < 0 ? -rounded : rounded;
}

function normalizeValueTextForCompare(value: string): string {
    const isIntegerDisplay = INTEGER_DISPLAY_VALUE_PATTERN.test(value);
    const isDecimalDisplay = DECIMAL_DISPLAY_VALUE_PATTERN.test(value);
    if (!isIntegerDisplay && !isDecimalDisplay) return value;

    const withoutCommas = value.replace(/,/g, "");
    const negative = withoutCommas.charAt(0) === "-";
    const unsigned = negative ? withoutCommas.substring(1) : withoutCommas;
    const dot = unsigned.indexOf(".");
    const wholeRaw = dot === -1 ? unsigned : unsigned.substring(0, dot);

    let whole = wholeRaw.replace(/^0+/, "");
    if (whole === "") whole = "0";

    if (isIntegerDisplay) {
        if (whole === "0") return "0";
        return `${negative ? "-" : ""}${whole}`;
    }

    const numericValue = Number(withoutCommas);
    if (!Number.isFinite(numericValue)) return value;

    const normalized = quantizeHousingDecimal(numericValue);
    if (Object.is(normalized, -0) || normalized === 0) return "0.0";

    const formatted = String(normalized);
    return formatted.indexOf(".") === -1 ? `${formatted}.0` : formatted;
}

/**
 * The diff matcher (`actions/diff.ts`) compares the same action / condition
 * objects pairwise O(n²) times — once per candidate pair across the exact,
 * note-only, and cost passes. Recomputing the canonical compare string each
 * time means re-stringifying an entire CONDITIONAL tree on every comparison,
 * which for a function with hundreds of conditionals blocks the main thread
 * for minutes (game freeze + server disconnect). Memoize the string per
 * object so each is built once. The serialized key is byte-identical to the
 * comparison key on every comparison. Objects are read-only for the duration
 * of a diff and rebuilt fresh per read, so a WeakMap keyed by identity can't
 * go stale across diffs.
 */
const compareKeyCache = new WeakMap<object, string>();
const compareKeyNoNoteCache = new WeakMap<object, string>();

function cachedCompareKey(value: object): string {
    const hit = compareKeyCache.get(value);
    if (hit !== undefined) return hit;
    const key = serializeCompareValue(value);
    compareKeyCache.set(value, key);
    return key;
}

function compareKeyNoNote(value: { note?: unknown }): string {
    const hit = compareKeyNoNoteCache.get(value);
    if (hit !== undefined) return hit;
    const key = serializeCompareValue(stripNote(value));
    compareKeyNoNoteCache.set(value, key);
    return key;
}

export function actionsEqual(
    observed: Action | Observed,
    desired: Action | Observed
): boolean {
    return cachedCompareKey(observed) === cachedCompareKey(desired);
}

export function conditionsEqual(
    observed: Condition | Observed<Condition> | null,
    desired: Condition | Observed<Condition> | null
): boolean {
    if (observed === null || desired === null) return observed === desired;
    return cachedCompareKey(observed) === cachedCompareKey(desired);
}

export function actionCompareKey(value: Action | Observed): string {
    return serializeCompareValue(value);
}

export function actionListCompareKey(
    value: ReadonlyArray<Action | Observed | null>
): string {
    return serializeCompareValue(value);
}

export function conditionCompareKey(
    value: Condition | Observed<Condition> | null
): string {
    return serializeCompareValue(value);
}

export function notesEqual(left: string | undefined, right: string | undefined): boolean {
    return noteCompareKey(left) === noteCompareKey(right);
}

export function noteCompareKey(value: string | undefined): string | undefined {
    return value === undefined ? undefined : JSON.stringify(normalizeNoteText(value));
}

function stripNote<T extends { note?: unknown }>(value: T): T {
    const { note: _note, ...rest } = value;
    return rest as T;
}

export function actionOnlyNoteDiffers(
    desired: Action,
    current: Action | Observed
): boolean {
    return (
        desired.type === current.type &&
        compareKeyNoNote(desired) === compareKeyNoNote(current) &&
        !notesEqual(desired.note, current.note)
    );
}

export function conditionOnlyNoteDiffers(
    desired: Condition,
    current: Condition | null
): boolean {
    if (current === null) return false;
    return (
        compareKeyNoNote(desired) === compareKeyNoNote(current) &&
        !notesEqual(desired.note, current.note)
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
        const numericDisplay = normalizeValueTextForCompare(value);
        return numericDisplay === value ? collapseInteriorSpaces(value) : numericDisplay;
    }
    if (kind === "item" && typeof value === "string") {
        return canonicalVanillaItemCompareName(value);
    }
    if (kind === "location") {
        return canonicalizeLocationValue(value);
    }
    if (kind === "select" || kind === "cycle") {
        if (typeof value === "string") return { type: value };
    }
    return value;
}

function collapseInteriorSpaces(value: string): string {
    const first = value.search(/[^ ]/);
    if (first < 0) return value;
    let last = value.length - 1;
    while (last > first && value.charAt(last) === " ") last--;
    return (
        value.substring(0, first) +
        value.substring(first, last + 1).replace(/ {2,}/g, " ") +
        value.substring(last + 1)
    );
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

/**
 * Serialize the Housing-equivalent form without materializing a second action
 * tree. Importable-cache hashes and live diffing therefore use the same path.
 */
function serializeCompareValue(value: unknown): string {
    if (value === null) return "null";

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
            parts.push(serializeCompareValue(value[i]));
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
            if (fieldValueMatchesDefault(recordType, key, fieldValue)) continue;
        }

        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;

        const serialized =
            key === "note" && typeof fieldValue === "string"
                ? JSON.stringify(normalizeNoteText(fieldValue))
                : serializeCompareValue(fieldValue);

        parts.push(JSON.stringify(key) + ":" + serialized);
    }
    return "{" + parts.join(",") + "}";
}

// The canonicalized default for a (type, prop) is constant. Cache it so the
// serializer compares each field against a precomputed default key.
type CachedDefault = { value: unknown; key: string; scalar: boolean };
const canonicalDefaultCache = new Map<string, CachedDefault | null>();

export function canonicalDefaultCacheSize(): number {
    return canonicalDefaultCache.size;
}

export function fieldValueMatchesDefault(
    type: string,
    prop: string,
    value: unknown
): boolean {
    const cachedDef = canonicalDefaultFor(type, prop);
    if (cachedDef === null) return false;
    if (!cachedDef.scalar) return stableStringify(value) === cachedDef.key;
    return (
        value === cachedDef.value ||
        (typeof cachedDef.value === "string" && value === JSON.stringify(cachedDef.value))
    );
}

function canonicalDefaultFor(type: string, prop: string): CachedDefault | null {
    const cacheKey = `${type}\u0000${prop}`;
    const hit = canonicalDefaultCache.get(cacheKey);
    if (hit !== undefined) return hit;
    const rawDefault = getFieldDefault(type, prop);
    const def = canonicalizeFieldValue(type, prop, rawDefault);
    const result: CachedDefault | null =
        def === undefined
            ? null
            : {
                  value: def,
                  key: stableStringify(def),
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
    return (
        scalarFieldCompareKey(type, prop, observed[prop]) !==
        scalarFieldCompareKey(type, prop, desired[prop])
    );
}

export function scalarFieldHasNonDefaultValue(
    desired: Record<string, unknown>,
    type: string,
    prop: string
): boolean {
    return scalarFieldCompareKey(type, prop, desired[prop]) !== undefined;
}

export function scalarFieldCompareKey(
    type: string,
    prop: string,
    value: unknown
): string | undefined {
    if (value === undefined) return undefined;
    const coerced = canonicalizeFieldValue(type, prop, value);
    if (fieldValueMatchesDefault(type, prop, coerced)) return undefined;
    return serializeCompareValue(coerced);
}
