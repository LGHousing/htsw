import type { CanonicalizeItemName } from "./itemReferences";
import type { UiFieldKind } from "../fields/loreSpecs";

type FieldSpec = { prop: string; kind: UiFieldKind };
type MappingTable = Partial<Record<string, { loreFields: Record<string, FieldSpec> }>>;

export function canonicalizeItemFields(
    node: { type: string },
    mapping: MappingTable,
    canonicalizeItemName: CanonicalizeItemName
): void {
    const fields = mapping[node.type]?.loreFields;
    if (fields === undefined) return;
    for (const label in fields) {
        if (fields[label].kind !== "item") continue;
        const prop = fields[label].prop;
        const value = (node as Record<string, unknown>)[prop];
        if (typeof value === "string") {
            (node as Record<string, unknown>)[prop] = canonicalizeItemName(value);
        }
    }
}
