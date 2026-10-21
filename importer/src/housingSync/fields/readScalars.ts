import type TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { readStringValue } from "../menus/menuUtils";
import {
    scalarFieldLooksTruncated,
    parseLocationField,
    stripNumericGroupingCommas,
} from "./loreParsing";
import type { UiFieldKind } from "./loreSpecs";

/** Recover only fields flagged from the original list preview, even if a reader dropped one. */
export function refreshTruncatedScalarFields(
    ctx: TaskContext,
    current: { type: string },
    fields: readonly { label: string; prop: string; kind: UiFieldKind }[]
): void {
    const values = current as Record<string, unknown>;
    for (const field of fields) {
        const existing = values[field.prop];
        if (existing !== undefined && !scalarFieldLooksTruncated(existing, field.kind))
            continue;
        const teamHolder = field.kind === "cycle";
        const slot = ctx.tryGetItemSlot(teamHolder ? "Team" : field.label);
        const value = slot === null ? null : readStringValue(slot);
        if (value === null) {
            throw new Error(
                `Could not read the full value of ${current.type}.${field.prop} from its editor (truncated preview).`
            );
        }
        // Current Value is the full editor value, including literal trailing dots.
        // Only the list preview uses an ellipsis to abbreviate a value.
        if (teamHolder) {
            values[field.prop] = { type: "Team", team: removedFormatting(value).trim() };
        } else if (field.kind === "location") {
            values[field.prop] = parseLocationField(value);
        } else {
            values[field.prop] =
                field.kind === "select"
                    ? removedFormatting(value).trim()
                    : stripNumericGroupingCommas(value);
        }
    }
}
