import type { Tag } from "htsw/nbt";

import { removedFormatting } from "../../utils/helpers";
import { canonicalSlug } from "../../project/paths";

export function itemActionPaths(outputDir: string, name: string): { left: string; right: string } {
    const slug = canonicalSlug(name);
    return {
        left: `${outputDir}/${slug}_left.htsl`,
        right: `${outputDir}/${slug}_right.htsl`,
    };
}

export function itemActionSummaryHasActions(lore: readonly string[]): boolean {
    let actionsHeading = false;
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        if (line === "Actions:") {
            actionsHeading = true;
            continue;
        }
        if (!actionsHeading) continue;
        if (!line.startsWith("- ")) break;
        if (line.substring(2).trim().toLowerCase() !== "none") return true;
    }
    return false;
}

export function itemNbtHasInteractData(nbt: Tag): boolean {
    if (nbt.type !== "compound") return false;
    const tag = nbt.value.tag;
    if (tag?.type !== "compound") return false;
    const extra = tag.value.ExtraAttributes;
    if (extra?.type !== "compound") return false;
    return extra.value.interact_data !== undefined;
}

export function itemIdFromNbt(nbt: Tag): string | null {
    if (nbt.type !== "compound") return null;
    const id = nbt.value.id;
    return id?.type === "string" ? id.value : null;
}
