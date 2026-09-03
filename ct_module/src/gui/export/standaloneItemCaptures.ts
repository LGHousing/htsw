import * as htsw from "htsw";
import { MINECRAFT_ITEMS } from "htsw/types";

import type { ItemCaptureSink } from "../../housingSync/items/capture";
import {
    canonicalLiveItemSnbtKey,
    canonicalLiveItemTagKey,
    defaultVanillaItemId,
} from "../../housingSync/items/itemNbt";
import { canonicalSlug } from "../../project/paths";
import { removedFormatting } from "../../utils/helpers";
import { extractInteractDataSnbt } from "../../utils/nbt";
import {
    numericTagValue,
    slugForUnnamedItem,
} from "../../importables/items/itemSlug";

export type StandaloneItemCaptureEntry = {
    reference: string;
    snbt: string;
    hasClickActions: boolean;
};

type CapturedEntry = StandaloneItemCaptureEntry & { needsWrite: boolean };

export class StandaloneItemCaptures implements ItemCaptureSink {
    private readonly entriesByKey = Object.create(null) as Partial<
        Record<string, CapturedEntry>
    >;
    private readonly usedReferences = Object.create(null) as Partial<
        Record<string, true>
    >;

    public constructor(
        private readonly existingSnbt: (reference: string) => string | null
    ) {}

    register(snbt: string, displayNameHint: string): string {
        const key = canonicalLiveItemSnbtKey(snbt);
        const vanillaReference = vanillaReferenceForSnbt(snbt, key);
        if (vanillaReference !== null) return vanillaReference;

        const registered = this.entriesByKey[key];
        if (registered !== undefined) return registered.reference;

        const base = slugForDisplayName(displayNameHint, snbt);
        let suffix = 1;
        while (suffix < 1000) {
            const slug = suffix === 1 ? base : `${base}_${suffix}`;
            const reference = `items/${slug}.snbt`;
            if (this.usedReferences[reference]) {
                suffix++;
                continue;
            }
            const existing = this.existingSnbt(reference);
            if (existing === null || canonicalLiveItemSnbtKey(existing) === key) {
                this.entriesByKey[key] = {
                    reference,
                    snbt,
                    hasClickActions: extractInteractDataSnbt(snbt) !== null,
                    needsWrite: existing === null,
                };
                this.usedReferences[reference] = true;
                return reference;
            }
            suffix++;
        }
        throw new Error(`Could not choose an item filename for '${displayNameHint}'`);
    }

    registerBlockReference(snbt: string, displayNameHint: string): string {
        return defaultVanillaItemId(snbt) ?? this.register(snbt, displayNameHint);
    }

    entriesToWrite(): StandaloneItemCaptureEntry[] {
        return Object.keys(this.entriesByKey)
            .map((key) => this.entriesByKey[key])
            .filter((entry): entry is CapturedEntry => entry?.needsWrite === true)
            .map(({ reference, snbt, hasClickActions }) => ({
                reference,
                snbt,
                hasClickActions,
            }));
    }

    clickActionItemCount(): number {
        return Object.keys(this.entriesByKey).filter(
            (key) => this.entriesByKey[key]?.hasClickActions === true
        ).length;
    }
}

function vanillaReferenceForSnbt(snbt: string, key: string): string | null {
    let parsed: htsw.nbt.Tag;
    try {
        parsed = htsw.nbt.parseSnbtText(snbt);
    } catch (_error) {
        return null;
    }
    if (parsed.type !== "compound") return null;

    const idTag = parsed.value.id;
    if (idTag?.type !== "string") return null;
    const rawId = idTag.value;
    const id = rawId.indexOf("minecraft:") === 0 ? rawId : `minecraft:${rawId}`;
    const name = id.slice("minecraft:".length);
    const damageTag = parsed.value.Damage;
    const damage = damageTag === undefined ? 0 : numericTagValue(damageTag);
    if (damage === null) return null;

    let candidate: string | undefined;
    if (damage === 0) {
        candidate = id;
    } else {
        const item = MINECRAFT_ITEMS.find((entry) => entry.name === name);
        const variation = item?.variations?.find((entry) => entry.metadata === damage);
        if (variation !== undefined) {
            candidate = htsw.items.vanillaVariationReferenceName(variation.displayName);
        }
    }
    if (candidate === undefined) return null;

    const resolved = htsw.items.resolveVanillaItemReference(candidate);
    return resolved !== undefined && canonicalLiveItemTagKey(resolved.nbt) === key
        ? candidate
        : null;
}

function slugForDisplayName(displayName: string, snbt: string): string {
    const slug = canonicalSlug(removedFormatting(displayName).trim().toLowerCase());
    return slug.length > 0 ? slug : slugForUnnamedItem(snbt);
}
