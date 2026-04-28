/**
 * Printers for argument-level types: locations, values, sounds,
 * inventory slots, and other discriminated unions used by actions/conditions.
 */

import type {
    InventorySlot,
    Location,
    Sound,
    Value,
} from "../../types";
import { SOUNDS } from "../../types/constants";
import { quoteString, isPlaceholderOnly } from "./helpers";

/**
 * Emits an enum option (e.g. "Custom Coordinates", "Adventure", "Hand")
 * with spaces converted to underscores so it lexes as a single ident.
 *
 * `parseOption` normalizes by stripping spaces/underscores and lowercasing,
 * so any of `Custom_Coordinates`, `custom_coordinates`, `customcoordinates`
 * round-trip equivalently. We pick the canonical underscore form.
 */
export function printOption(option: string): string {
    // Use split/join instead of `replaceAll` — the language bundle is
    // consumed by ct_module which runs on a Rhino runtime targeting ES5.
    return option.split(" ").join("_");
}

/**
 * Emits a Value verbatim. The parser produces values in self-describing form:
 *   - `"hello"`        — quoted string
 *   - `%player.name%`  — placeholder
 *   - `42`             — bare integer
 *   - `3.14...`        — bare double
 *   - `"%foo%L"`       — quoted-and-cast placeholder for long/double promotion
 *
 * Each form re-parses to the same Value, so emitting verbatim is safe.
 */
export function printValue(value: Value): string {
    return value;
}

export function printLocation(loc: Location): string {
    if (loc.type === "Custom Coordinates") {
        return `${printOption(loc.type)} ${quoteString(loc.value)}`;
    }
    return printOption(loc.type);
}

export function printInventorySlot(slot: InventorySlot): string {
    if (typeof slot === "number") {
        return String(slot);
    }
    return printOption(slot);
}

export function printSound(sound: Sound): string {
    // Prefer the friendly name (e.g. `Click`) when one matches the path; fall
    // back to the quoted raw key for custom paths.
    const named = SOUNDS.find((s) => s.path === sound);
    if (named) return printOption(named.name);
    return quoteString(sound);
}

/**
 * Emits a placeholder argument used in COMPARE_PLACEHOLDER, where the value
 * is stored as `%xxx%`. The parser accepts both bare-placeholder and
 * quoted-placeholder forms, but the bare form is more idiomatic.
 */
export function printNumericalPlaceholder(p: string): string {
    if (isPlaceholderOnly(p)) return p;
    // Defensive fallback: wrap in quotes if for some reason it isn't a clean
    // placeholder. parseNumericalPlaceholder will accept a quoted string
    // matching `^%...%$`.
    return quoteString(p);
}

export function printBoolean(b: boolean): string {
    return b ? "true" : "false";
}

export function printNumber(n: number): string {
    return String(n);
}
