import * as htsw from "htsw";
import type { Tag } from "htsw/nbt";

import { itemToHtswTag } from "../../utils/nbt";
import { stableStringify } from "../../utils/helpers";
import {
    canonicalItemShellTag,
    canonicalLiveItemTag,
    stripInteractData,
    type TagLike,
} from "./itemTag";

export function canonicalItemShellKey(item: Item): string {
    return canonicalItemShellTagKey(itemToHtswTag(item));
}

export function canonicalLiveItemKey(item: Item): string {
    return canonicalLiveItemTagKey(itemToHtswTag(item));
}

export function canonicalItemShellTagKey(tag: TagLike): string {
    return stableStringify(canonicalItemShellTag(tag));
}

export function canonicalLiveItemTagKey(tag: TagLike): string {
    return stableStringify(canonicalLiveItemTag(tag));
}

export function canonicalItemShellSnbtKey(snbt: string): string {
    return canonicalSnbtKey(snbt, false);
}

export function canonicalLiveItemSnbtKey(snbt: string): string {
    return canonicalSnbtKey(snbt, true);
}

export function defaultVanillaItemId(snbt: string): string | null {
    try {
        const tag = canonicalLiveItemTag(htsw.nbt.parseSnbtText(snbt));
        if (tag.type !== "compound") return null;
        const value = tag.value as Partial<Record<string, TagLike>>;
        if (Object.keys(value).length !== 1) return null;
        const id = value.id;
        if (id?.type !== "string") return null;
        const itemId = String(id.value);
        return itemId.indexOf("minecraft:") === 0 ? itemId : null;
    } catch (_error) {
        return null;
    }
}

function canonicalSnbtKey(snbt: string, live: boolean): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return live ? canonicalLiveItemTagKey(tag) : canonicalItemShellTagKey(tag);
    } catch (_error) {
        return snbt;
    }
}

export function prettySnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(tag, { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

export function portableItemSnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(stripInteractData(tag) as Tag, {
            pretty: true,
        });
    } catch (_error) {
        return snbt;
    }
}

export function normalizeItemSnbtForExport(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(tag, { pretty: false });
    } catch (_error) {
        return snbt;
    }
}

export function snbtFromItem(item: Item, opts: { pretty: boolean }): string {
    const tag = itemToHtswTag(item);
    return htsw.nbt.printSnbt(tag, { pretty: opts.pretty });
}
