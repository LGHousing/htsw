import type { Action, Condition } from "htsw/types";
import type { Observed, ObservedActionSlot } from "../importer/types";
import { getActionFieldDefault } from "../importer/actionMappings";
import { getConditionFieldDefault } from "../importer/conditionMappings";

/**
 * Convert an `ObservedActionSlot[]` (the importer's read shape, which carries
 * GUI metadata and may have null entries for unrecognized actions) into a
 * clean `Action[]` suitable for emission.
 *
 * Drops:
 *   - top-level slots whose action couldn't be parsed (`entry.action === null`),
 *   - nested action-list entries that are null (same reason),
 *   - fields whose lore-parsed value equals the housing UI default for
 *     that field (e.g. DROP_ITEM.location === "Not Set"). Default-stripping
 *     mirrors what `normalizeActionCompare` does at diff time: it makes
 *     observed actions conform to the canonical shape the language type
 *     and printer expect. Without this step, fields like `location:
 *     "Not Set"` (a lore string the housing UI uses for "unset") would
 *     reach the printer, which expects `Location` to be either an
 *     object `{ type: ... }` or undefined, and emits garbage otherwise.
 */
export function observedSlotsToActions(slots: readonly ObservedActionSlot[]): Action[] {
    const result: Action[] = [];
    for (const slot of slots) {
        if (slot.action === null) continue;
        result.push(observedActionToAction(slot.action));
    }
    return result;
}

/**
 * Walk an `Observed<Action>` and produce a canonical `Action`. The two
 * shapes differ in nested array element types (`Action[]` vs.
 * `Array<Observed<Action> | null>`) — strip nulls — AND in field-value
 * shapes for lore-parsed scalars (strings vs. objects, default-equal
 * values vs. omitted) — strip defaults to match the language type.
 */
function observedActionToAction(observed: Observed<Action>): Action {
    // Recurse into known nested-list-bearing types first; default-strip
    // their non-list fields just like everything else.
    if (observed.type === "CONDITIONAL") {
        const cleaned = stripActionDefaults({
            type: "CONDITIONAL",
            matchAny: observed.matchAny,
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        } as Observed<Action>);
        return {
            ...(cleaned as Extract<Action, { type: "CONDITIONAL" }>),
            conditions: (observed.conditions ?? [])
                .filter((c): c is NonNullable<typeof c> => c !== null)
                .map(stripConditionDefaults),
            ifActions: (observed.ifActions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
            elseActions: (observed.elseActions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
        };
    }
    if (observed.type === "RANDOM") {
        return {
            type: "RANDOM",
            actions: (observed.actions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        };
    }
    return stripActionDefaults(observed) as Action;
}

/**
 * Drop fields whose lore-parsed value equals the mapping's `default:`.
 * Mirrors `normalizeActionCompare` in `importer/compare.ts` but applied
 * to the emitted action, not just the diff-comparison view. Without this
 * the printer sees "Not Set" / "Any Amount" / etc. as concrete string
 * values where it expects either an object form or undefined, and emits
 * `<unset>` placeholders.
 */
function stripActionDefaults(observed: Observed<Action>): Observed<Action> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(observed)) {
        const value = (observed as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (key !== "type" && key !== "note") {
            const def = getActionFieldDefault(observed.type, key);
            if (def !== undefined && shallowEqual(value, def)) continue;
            // Empty arrays parse the same as "field omitted", so drop
            // them too — same convention `normalizeActionCompare` uses
            // at diff time.
            if (Array.isArray(value) && value.length === 0) continue;
        }
        out[key] = value;
    }
    return out as Observed<Action>;
}

function stripConditionDefaults(observed: Condition): Condition {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(observed)) {
        const value = (observed as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (key !== "type" && key !== "note" && key !== "inverted") {
            const def = getConditionFieldDefault(observed.type, key);
            if (def !== undefined && shallowEqual(value, def)) continue;
            if (Array.isArray(value) && value.length === 0) continue;
        }
        out[key] = value;
    }
    return out as Condition;
}

function shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    // Wrap bare strings as `{ type: <string> }` for cycle/select fields —
    // matches `canonicalizeFieldValue` in compare.ts so default-stripping
    // works the same for either shape.
    if (typeof a === "string" && typeof b === "object" && b !== null) {
        return (b as { type?: unknown }).type === a;
    }
    if (typeof b === "string" && typeof a === "object" && a !== null) {
        return (a as { type?: unknown }).type === b;
    }
    // Both objects: compare the `type` discriminator and any `value`.
    // Used for Location defaults like `{ type: "Not Set" }` matching the
    // lore-parsed observation of the same shape.
    if (
        typeof a === "object" && a !== null &&
        typeof b === "object" && b !== null
    ) {
        const aRec = a as { type?: unknown; value?: unknown };
        const bRec = b as { type?: unknown; value?: unknown };
        return aRec.type === bRec.type && aRec.value === bRec.value;
    }
    return false;
}
