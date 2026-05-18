import type { ItemRegistry } from "../../importables/itemRegistry";
import type { UiFieldKind } from "../types";

type FieldSpec = { prop: string; kind: UiFieldKind };
type MappingTable = Record<string, { loreFields: Record<string, FieldSpec> }>;

/**
 * Walks a node (action or condition) and re-routes every `kind: "item"`
 * lore-field through the registry's display-name canonicalizer, so an
 * observed-stripped name compares equal to the source-canonical name when
 * diffing.
 *
 * Spec-driven on purpose: adding a new item-bearing type just requires
 * declaring `kind: "item"` in its mapping — no hardcoded type-name list
 * here to remember to update.
 */
export function canonicalizeItemFields(
    node: { type: string },
    mapping: MappingTable,
    itemRegistry: ItemRegistry
): void {
    const fields = mapping[node.type]?.loreFields;
    if (fields === undefined) return;
    for (const label in fields) {
        if (fields[label].kind !== "item") continue;
        const prop = fields[label].prop;
        const value = (node as Record<string, unknown>)[prop];
        if (typeof value === "string") {
            (node as Record<string, unknown>)[prop] =
                itemRegistry.canonicalizeObservedName(value);
        }
    }
}
