import type { Action, Condition } from "htsw/types";
import { MINECRAFT_ITEMS } from "htsw/types";

export type CanonicalizeItemName = (name: string) => string;

export type ResolveItemField = (
    owner: Action | Condition,
    itemName: string,
    kind: "action" | "condition"
) => Promise<Item>;

type VanillaItem = (typeof MINECRAFT_ITEMS)[number] & {
    variations?: readonly { metadata: number; displayName: string }[];
};

const VANILLA_ITEM_COMPARE_NAMES: Partial<Record<string, string>> = {};

for (const item of MINECRAFT_ITEMS as readonly VanillaItem[]) {
    registerVanillaItemCompareName(item.name, item.displayName);
    registerVanillaItemCompareName(item.displayName, item.displayName);
    for (const variation of item.variations ?? []) {
        const referenceName = variation.displayName.toLowerCase().replace(/ /g, "_");
        const displayName =
            variation.metadata === 0 ? item.displayName : variation.displayName;
        registerVanillaItemCompareName(referenceName, displayName);
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
