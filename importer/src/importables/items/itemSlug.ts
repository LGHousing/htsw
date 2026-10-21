import * as htsw from "htsw";
import { MINECRAFT_ITEMS } from "htsw/types";

import { canonicalSlug } from "../../project/paths";

export function slugForUnnamedItem(snbt: string): string {
    let parsed: htsw.nbt.Tag;
    try {
        parsed = htsw.nbt.parseSnbtText(snbt);
    } catch (_error) {
        return "captured_item";
    }
    if (parsed.type !== "compound") return "captured_item";

    const idTag = parsed.value.id;
    if (idTag?.type !== "string") return "captured_item";
    const bareId = idTag.value.replace(/^minecraft:/, "");
    if (bareId.length === 0) return "captured_item";

    const damageTag = parsed.value.Damage;
    const damage = damageTag === undefined ? 0 : numericTagValue(damageTag);
    if (damage !== null && damage !== 0) {
        const item = MINECRAFT_ITEMS.find((entry) => entry.name === bareId);
        const variation = item?.variations?.find((entry) => entry.metadata === damage);
        if (variation !== undefined) {
            const variationName = htsw.items.vanillaVariationReferenceName(
                variation.displayName
            );
            const variationSlug = canonicalSlug(variationName);
            if (variationSlug.length > 0) return variationSlug;
        }
    }

    const idSlug = canonicalSlug(bareId);
    return idSlug.length > 0 ? idSlug : "captured_item";
}

export function numericTagValue(tag: htsw.nbt.Tag): number | null {
    if (
        tag.type !== "byte" &&
        tag.type !== "short" &&
        tag.type !== "int" &&
        tag.type !== "long" &&
        tag.type !== "float" &&
        tag.type !== "double"
    ) {
        return null;
    }
    return Number(tag.value);
}
