// Split out from helpers.ts so that mapping tables (actionMappings.ts,
// conditionMappings.ts) and diff/compare code can consume lore parsers
// without transitively pulling in the GUI toolkit (waitForMenu, anvil
// reflection, click flows, TaskContext, etc.).
//
// Rule of thumb for what lives here: synchronous, no TaskContext, no
// clicking. Reading a passed-in ItemSlot's lore is fine; driving the GUI
// is not. Read-then-click pairs (e.g. readBooleanValue / setBooleanValue)
// stay together in helpers.ts.

import type { ItemSlot } from "../../tasks/specifics/slots";
import { normalizeFormattingCodes, removedFormatting } from "../../utils/helpers";
import type { UiFieldKind } from "../types";

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

function parseBooleanText(value: string): boolean | undefined {
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

function parseFieldValue(
    kind: UiFieldKind,
    value: string
): string | boolean | undefined {
    switch (kind) {
        case "value":
            return stripNumericGroupingCommas(normalizeLoreValueFormatting(value));
        case "cycle":
        case "select":
        case "item":
            return removedFormatting(value).trim();
        case "boolean":
            return parseBooleanText(value);
        case "nestedList":
            return undefined;
        default:
            const _exhaustiveCheck: never = kind;
            return _exhaustiveCheck;
    }
}

export function parseLoreFields<TProp extends string>(
    slot: ItemSlot,
    loreFields: Record<string, { prop: TProp; kind: UiFieldKind }>
): Partial<Record<TProp, string | boolean>> {
    const parsed: Partial<Record<TProp, string | boolean>> = {};

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
