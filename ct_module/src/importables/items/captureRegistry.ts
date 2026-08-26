import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";

import { canonicalSlug } from "../../project/paths";
import { extractInteractDataSnbt } from "../../utils/nbt";
import { removedFormatting } from "../../utils/helpers";
import {
    canonicalItemShellSnbtKey,
    canonicalItemShellTagKey,
    canonicalLiveItemSnbtKey,
    canonicalLiveItemTagKey,
    normalizeItemSnbtForExport,
} from "../../housingSync/items/itemNbt";
import {
    canonicalLiveItemTag,
    tagChild,
    type TagLike,
} from "../../housingSync/items/itemTag";
import {
    itemInteractDataMatches,
    type InteractDataExpectation,
} from "./interactDataCache";

export type CapturedItem = {
    name: string;
    snbt: string;
    displayName: string;
    seeded: boolean;
    expectedInteractData?: InteractDataExpectation;
    canonicalTagKey?: string;
};

type RegistryItem = CapturedItem & {
    shellKey: string;
    exactKey?: string;
};

export type ItemCaptureIdentity = "live" | "shell";

export class ItemCaptureRegistry {
    private readonly entriesByName = Object.create(null) as Partial<
        Record<string, RegistryItem>
    >;
    private readonly exactNamesByKey = Object.create(null) as Partial<
        Record<string, string[]>
    >;
    private readonly shellNamesByKey = Object.create(null) as Partial<
        Record<string, string[]>
    >;
    private readonly seededDisplayNames = Object.create(null) as Partial<
        Record<string, string>
    >;
    private readonly matchedNames = Object.create(null) as Record<string, true>;
    private readonly capturedNames = Object.create(null) as Record<string, true>;
    private hintLines: string[] = [];

    public constructor(private readonly identity: ItemCaptureIdentity) {}

    seedExportItem(
        item: ImportableItem,
        expectedInteractData: InteractDataExpectation
    ): void {
        const shellKey = canonicalItemShellTagKey(item.nbt);
        let exactKey: string | undefined;
        if (this.identity === "shell") {
            exactKey = shellKey;
        } else if (expectedInteractData.kind === "absent") {
            exactKey = canonicalLiveItemTagKey(item.nbt);
        }
        this.seed(
            item.name,
            shellKey,
            exactKey,
            displayNameFromTag(item.nbt),
            expectedInteractData
        );
    }

    seedNbtOnly(name: string, nbt: ImportableItem["nbt"]): void {
        const shellKey = canonicalItemShellTagKey(nbt);
        const exactKey =
            this.identity === "shell" ? shellKey : canonicalLiveItemTagKey(nbt);
        this.seed(name, shellKey, exactKey, displayNameFromTag(nbt), undefined);
    }

    private seed(
        name: string,
        shellKey: string,
        exactKey: string | undefined,
        displayName: string | null,
        expectedInteractData: InteractDataExpectation | undefined
    ): void {
        if (this.entriesByName[name] !== undefined) return;
        const entry: RegistryItem = {
            name,
            snbt: "",
            displayName: displayName ?? "",
            seeded: true,
            expectedInteractData,
            canonicalTagKey: shellKey,
            shellKey,
            exactKey,
        };
        this.entriesByName[name] = entry;
        this.addName(this.shellNamesByKey, shellKey, name);
        if (exactKey !== undefined) this.addName(this.exactNamesByKey, exactKey, name);
        if (displayName !== null && this.seededDisplayNames[displayName] === undefined) {
            this.seededDisplayNames[displayName] = name;
        }
    }

    register(snbt: string, displayNameHint: string): string {
        const normalizedSnbt = normalizeItemSnbtForExport(snbt);
        const shellKey = canonicalItemShellSnbtKey(normalizedSnbt);
        const exactKey =
            this.identity === "shell"
                ? shellKey
                : canonicalLiveItemSnbtKey(normalizedSnbt);
        const exactName = this.exactNamesByKey[exactKey]?.[0];
        if (exactName !== undefined) {
            const exact = this.entriesByName[exactName] as RegistryItem;
            this.capturedNames[exact.name] = true;
            if (exact.seeded) this.matchedNames[exact.name] = true;
            return exact.name;
        }

        if (this.identity === "live") {
            const seededCandidates = (this.shellNamesByKey[shellKey] ?? []).filter(
                (name) => this.entriesByName[name]?.seeded === true
            );
            const expectationMatches = seededCandidates.filter((name) => {
                const expected = this.entriesByName[name]?.expectedInteractData;
                return (
                    expected !== undefined &&
                    itemInteractDataMatches(normalizedSnbt, expected)
                );
            });
            if (expectationMatches.length > 0) {
                const matched = this.entriesByName[expectationMatches[0]] as RegistryItem;
                matched.exactKey = exactKey;
                this.addName(this.exactNamesByKey, exactKey, matched.name);
                this.matchedNames[matched.name] = true;
                this.capturedNames[matched.name] = true;
                return matched.name;
            }
            if (seededCandidates.length === 1) {
                const changed = this.entriesByName[seededCandidates[0]] as RegistryItem;
                if (changed.exactKey !== undefined) {
                    this.removeName(this.exactNamesByKey, changed.exactKey, changed.name);
                }
                changed.snbt = normalizedSnbt;
                changed.displayName = displayNameHint;
                changed.seeded = false;
                changed.exactKey = exactKey;
                this.addName(this.exactNamesByKey, exactKey, changed.name);
                this.capturedNames[changed.name] = true;
                return changed.name;
            }
            if (seededCandidates.length > 1) {
                this.hintLines.push(
                    `captured item has the same portable NBT as multiple existing items but different click actions — exported it as a new item`
                );
            }
        }

        const name = this.availableName(displayNameHint);
        const displayName = removedFormatting(displayNameHint).trim().toLowerCase();
        const owner = this.seededDisplayNames[displayName];
        if (owner !== undefined) {
            this.hintLines.push(
                `captured '${name}' (new) shares a display name with existing item '${owner}' but has different NBT — if it's an edit, delete the old one`
            );
        }

        this.entriesByName[name] = {
            name,
            snbt: normalizedSnbt,
            displayName: displayNameHint,
            seeded: false,
            shellKey,
            exactKey,
        };
        this.addName(this.shellNamesByKey, shellKey, name);
        this.addName(this.exactNamesByKey, exactKey, name);
        this.capturedNames[name] = true;
        return name;
    }

    registerBlockReference(snbt: string, displayNameHint: string): string {
        const normalizedSnbt = normalizeItemSnbtForExport(snbt);
        const exactKey =
            this.identity === "shell"
                ? canonicalItemShellSnbtKey(normalizedSnbt)
                : canonicalLiveItemSnbtKey(normalizedSnbt);
        if (this.exactNamesByKey[exactKey]?.[0] !== undefined) {
            return this.register(normalizedSnbt, displayNameHint);
        }

        return (
            defaultVanillaItemId(normalizedSnbt) ??
            this.register(normalizedSnbt, displayNameHint)
        );
    }

    needsWrite(name: string): boolean {
        return this.entriesByName[name]?.seeded === false;
    }

    newEntries(): CapturedItem[] {
        return this.entries().filter((entry) => !entry.seeded);
    }

    counts(): { matched: number; fresh: number } {
        return {
            matched: Object.keys(this.matchedNames).length,
            fresh: this.newEntries().length,
        };
    }

    takeHints(): string[] {
        const out = this.hintLines;
        this.hintLines = [];
        return out;
    }

    entries(): CapturedItem[] {
        const out: CapturedItem[] = [];
        for (const name of Object.keys(this.entriesByName)) {
            const entry = this.entriesByName[name];
            if (entry !== undefined) out.push(entry);
        }
        return out;
    }

    capturedItemNames(): string[] {
        return Object.keys(this.capturedNames);
    }

    matchedItemNames(): string[] {
        return Object.keys(this.matchedNames);
    }

    capturedInteractData(name: string): string | null {
        const snbt = this.entriesByName[name]?.snbt;
        return snbt === undefined || snbt.length === 0
            ? null
            : extractInteractDataSnbt(snbt);
    }

    size(): number {
        return Object.keys(this.entriesByName).length;
    }

    private availableName(displayNameHint: string): string {
        const preferred = slugForDisplayName(displayNameHint);
        let name = preferred;
        let suffix = 2;
        while (this.entriesByName[name] !== undefined && suffix < 1000) {
            name = `${preferred}_${suffix}`;
            suffix++;
        }
        return name;
    }

    private addName(
        index: Partial<Record<string, string[]>>,
        key: string,
        name: string
    ): void {
        const names = index[key];
        if (names === undefined) {
            index[key] = [name];
        } else if (names.indexOf(name) < 0) {
            names.push(name);
        }
    }

    private removeName(
        index: Partial<Record<string, string[]>>,
        key: string,
        name: string
    ): void {
        const names = index[key];
        if (names === undefined) return;
        const position = names.indexOf(name);
        if (position >= 0) names.splice(position, 1);
        if (names.length === 0) delete index[key];
    }
}

function defaultVanillaItemId(snbt: string): string | null {
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

function displayNameFromTag(root: unknown): string | null {
    const name = tagChild(tagChild(tagChild(root as TagLike, "tag"), "display"), "Name");
    if (name === undefined || name.type !== "string") return null;
    const stripped = removedFormatting(String(name.value)).trim().toLowerCase();
    return stripped.length > 0 ? stripped : null;
}

function slugForDisplayName(displayName: string): string {
    const stripped = removedFormatting(displayName).trim().toLowerCase();
    if (stripped.length === 0) return "captured_item";
    const slug = canonicalSlug(stripped);
    return slug.length > 0 ? slug : "captured_item";
}
