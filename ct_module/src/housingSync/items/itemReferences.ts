import type { Action, Condition } from "htsw/types";
import { MINECRAFT_ITEMS } from "htsw/types";
import { items as itemReferences } from "htsw";

export type CanonicalizeItemName = (name: string) => string;

export type ResolveItemField = (
    owner: Action | Condition,
    itemName: string,
    kind: "action" | "condition"
) => Promise<Item>;

const VANILLA_ITEM_COMPARE_NAMES: Partial<Record<string, string>> = {};
const VANILLA_BASE_NAMES = new Set(MINECRAFT_ITEMS.map((item) => item.name));

for (const item of MINECRAFT_ITEMS) {
    registerVanillaItemCompareName(item.name, item.displayName);
    registerVanillaItemCompareName(item.displayName, item.displayName);
}

for (const item of MINECRAFT_ITEMS) {
    for (const variation of item.variations ?? []) {
        const referenceName = itemReferences.vanillaVariationReferenceName(
            variation.displayName
        );
        const displayName =
            variation.metadata === 0 ? item.displayName : variation.displayName;
        if (!VANILLA_BASE_NAMES.has(referenceName)) {
            registerVanillaItemCompareName(referenceName, displayName);
        }
        registerVanillaItemCompareName(variation.displayName, displayName);
    }
}

function registerVanillaItemCompareName(name: string, canonical: string): void {
    VANILLA_ITEM_COMPARE_NAMES[name] = canonical;
    VANILLA_ITEM_COMPARE_NAMES[`minecraft:${name}`] = canonical;
}

export function canonicalVanillaItemCompareName(name: string): string {
    return VANILLA_ITEM_COMPARE_NAMES[name] ?? name;
}
