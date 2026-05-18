// Split out from helpers.ts so that mapping tables (actionMappings.ts,
// conditionMappings.ts) and diff/compare code can consume lore parsers
// without transitively pulling in the GUI toolkit (waitForMenu, anvil
// reflection, click flows, TaskContext, etc.).
//
// Rule of thumb for what lives here: synchronous, no TaskContext, no
// clicking. Reading a passed-in ItemSlot's lore is fine; driving the GUI
// is not. Read-then-click pairs (e.g. readBooleanValue / setBooleanValue)
// stay together in helpers.ts.

import type { ItemSlot } from "../tasks/specifics/slots";
import { normalizeFormattingCodes, removedFormatting } from "../utils/helpers";
import type { UiFieldKind } from "./types";

export function parseLoreKeyValueLine(
    line: string
): { label: string; value: string } | null {
    const unformattedLine = removedFormatting(line).trim();
    if (unformattedLine.startsWith("minecraft:") || unformattedLine.startsWith("NBT:")) {
        return null;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
        return null;
    }

    const label = removedFormatting(line.slice(0, separatorIndex)).trim();
    const rawValue = line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (label === "") {
        return null;
    }

    return { label, value };
}

export function parseBooleanText(value: string): boolean | undefined {
    const normalized = removedFormatting(value).trim();
    if (normalized === "Enabled") {
        return true;
    }
    if (normalized === "Disabled") {
        return false;
    }
    return undefined;
}

export function normalizeLoreValueFormatting(value: string): string {
    const normalized = normalizeFormattingCodes(value);
    let index = 0;

    while (normalized.slice(index, index + 2).toLowerCase() === "&r") {
        index += 2;
    }

    if (normalized.slice(index, index + 2).toLowerCase() === "&f") {
        index += 2;
    }

    while (normalized.slice(index, index + 2).toLowerCase() === "&r") {
        index += 2;
    }

    return normalized.slice(index);
}

export const INTEGER_DISPLAY_VALUE_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)$/;
export const DECIMAL_DISPLAY_VALUE_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)\.\d+$/;

function stripNumericGroupingCommas(value: string): string {
    if (value.indexOf(",") === -1) return value;
    if (
        !INTEGER_DISPLAY_VALUE_PATTERN.test(value) &&
        !DECIMAL_DISPLAY_VALUE_PATTERN.test(value)
    ) {
        return value;
    }
    return value.replace(/,/g, "");
}

export function parseFieldValue(
    kind: UiFieldKind,
    value: string
): string | boolean | LocationFieldValue | undefined {
    switch (kind) {
        case "value":
            return stripNumericGroupingCommas(normalizeLoreValueFormatting(value));
        case "cycle":
        case "select":
        case "item":
            return removedFormatting(value).trim();
        case "boolean":
            return parseBooleanText(value);
        case "location":
            return parseLocationField(value);
        case "nestedList":
            return undefined;
        default:
            const _exhaustiveCheck: never = kind;
            return _exhaustiveCheck;
    }
}

/**
 * Lore-parsed shape for a Location-typed field. Matches the HTSL
 * `Location` union (`language/src/types/types.ts`). For `Custom
 * Coordinates`, `value` is the coord string verbatim from the lore —
 * which may end with `...` if Hypixel truncated it for display. Callers
 * detect that suffix to decide whether to hydrate the action from the
 * editor.
 */
export type LocationFieldValue =
    | { type: "House Spawn Location" }
    | { type: "Invokers Location" }
    | { type: "Current Location" }
    | { type: "Custom Coordinates"; value: string }
    | { type: "Not Set" };

const KNOWN_LOCATION_LABELS = [
    "House Spawn Location",
    "Invokers Location",
    "Current Location",
    "Not Set",
] as const;

export function parseLocationField(value: string): LocationFieldValue {
    const cleaned = removedFormatting(value).trim();
    for (let i = 0; i < KNOWN_LOCATION_LABELS.length; i++) {
        const label = KNOWN_LOCATION_LABELS[i];
        if (cleaned === label) {
            return { type: label };
        }
    }
    // Anything else is the coord string Hypixel shows for `Custom
    // Coordinates`. May end with `...` if the value didn't fit on the
    // lore line — hydration recovers the full string from the editor.
    return {
        type: "Custom Coordinates",
        value: normalizeCoordinateString(cleaned),
    };
}

/**
 * Hypixel shows coord components separated by `, ` (e.g.
 * `~0.7, ~50, ~2`), and labels yaw/pitch positionally with their key
 * names (e.g. `1, 2, 3, yaw: 4, pitch: 5`). HTSW's `parseCoordinates`
 * splits by single space and expects bare values (`~0.7 ~50 ~2`,
 * `1 2 3 4 5`).
 *
 * Split on comma, trim each component, strip any leading `yaw:` /
 * `pitch:` label, rejoin with a single space. Idempotent: input
 * already in HTSL form has no commas and no labels, so the loop
 * passes it through unchanged.
 */
const COORDINATE_LABEL_PREFIX = /^(?:yaw|pitch):\s*/i;

function normalizeCoordinateString(raw: string): string {
    const parts = raw.split(",");
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        let trimmed = parts[i].trim();
        const labelMatch = trimmed.match(COORDINATE_LABEL_PREFIX);
        if (labelMatch !== null) {
            trimmed = trimmed.substring(labelMatch[0].length);
        }
        if (trimmed.length > 0) out.push(trimmed);
    }
    return out.join(" ");
}

export function parseLoreFields<TProp extends string>(
    slot: ItemSlot,
    loreFields: Record<string, { prop: TProp; kind: UiFieldKind }>
): Partial<Record<TProp, string | boolean | LocationFieldValue>> {
    const parsed: Partial<Record<TProp, string | boolean | LocationFieldValue>> = {};

    for (const line of slot.getItem().getLore()) {
        const keyValue = parseLoreKeyValueLine(line);
        if (keyValue === null) {
            continue;
        }

        const field = loreFields[keyValue.label];
        if (!field) {
            continue;
        }

        const value = parseFieldValue(field.kind, keyValue.value);
        if (value === undefined) {
            continue;
        }

        parsed[field.prop] = value;
    }

    return parsed;
}

export function readListItemNote(slot: ItemSlot): string | undefined {
    const lore = slot
        .getItem()
        .getLore()
        .map((line) => removedFormatting(line).trim());

    const instructionPatterns = [
        "Right Click to remove!",
        "Left Click to edit!",
        "Click to edit!",
        "Use shift and left/right click to change order.",
    ];

    let instructionIndex = -1;
    for (let i = 0; i < lore.length; i++) {
        if (instructionPatterns.indexOf(lore[i]) !== -1) {
            instructionIndex = i;
        }
    }
    if (instructionIndex === -1) {
        return undefined;
    }

    const noteLines: string[] = [];
    let inNote = false;
    for (let i = instructionIndex + 1; i < lore.length; i++) {
        const line = lore[i];

        if (!inNote && line === "") {
            continue;
        }

        if (
            line.startsWith("minecraft:") ||
            line.startsWith("NBT:") ||
            line.startsWith("LSHIFT ") ||
            line.startsWith("SHIFT ")
        ) {
            break;
        }

        inNote = true;
        noteLines.push(line);
    }

    if (noteLines.length === 0) {
        return undefined;
    }

    return noteLines.join("\n");
}

export function normalizeNoteText(note: string): string {
    return note
        .split("\n")
        .map((line) => normalizeLoreValueFormatting(line).trim())
        .join("\n")
        .trim();
}

/**
 * Lore parser for the holder field shared by `CHANGE_VAR` (action) and
 * `COMPARE_VAR` (condition). The lore exposes the holder as a bare string
 * ("Player" / "Global" / "Team"); when "Team", an additional "Team: <name>"
 * lore line carries the team name. Returns the fully-shaped holder object
 * the type system expects, or undefined if the raw value isn't a recognized
 * holder string.
 */
export function parseHolderField(
    slot: ItemSlot,
    rawHolder: unknown
): { type: "Player" | "Global" | "Team"; team?: string } | undefined {
    if (typeof rawHolder !== "string") return undefined;
    if (rawHolder === "Player" || rawHolder === "Global") {
        return { type: rawHolder };
    }
    if (rawHolder === "Team") {
        for (const line of slot.getItem().getLore()) {
            const kv = parseLoreKeyValueLine(line);
            if (kv !== null && kv.label === "Team") {
                return { type: "Team", team: removedFormatting(kv.value).trim() };
            }
        }
        return { type: "Team" };
    }
    return undefined;
}
