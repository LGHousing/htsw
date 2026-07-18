import type { Tag } from "htsw/nbt";

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
