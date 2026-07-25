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
        return htsw.nbt.printSnbt(tag as Tag, { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

export function portableItemSnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(stripInteractData(tag as TagLike) as Tag, {
            pretty: true,
        });
    } catch (_error) {
        return snbt;
    }
}

export function normalizeItemSnbtForExport(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(tag as Tag, { pretty: false });
    } catch (_error) {
        return snbt;
    }
}

export function snbtFromItem(item: Item, opts: { pretty: boolean }): string {
    const tag = itemToHtswTag(item);
    return htsw.nbt.printSnbt(tag as Tag, { pretty: opts.pretty });
}
