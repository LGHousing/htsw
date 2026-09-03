import * as htsw from "htsw";
import type { Tag } from "htsw/nbt";
import type { ImportableItem } from "htsw/types";

import { canonicalSlug } from "../../project/paths";
import { extractInteractDataSnbt } from "../../utils/nbt";
import { removedFormatting } from "../../utils/helpers";
import {
    canonicalItemShellSnbtKey,
    canonicalItemShellTagKey,
    canonicalLiveItemSnbtKey,
    canonicalLiveItemTagKey,
    defaultVanillaItemId,
    normalizeItemSnbtForExport,
} from "../../housingSync/items/itemNbt";
import { tagChild, type TagLike } from "../../housingSync/items/itemTag";
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
    // The same pair of keys for this item restacked to one, which is what a
    // `name@<count>` reference is matched against. They mirror the keys above
    // exactly, including `singleExactKey` being unknown for a seeded item whose
    // click-action payload has not been read back yet.
    singleShellKey: string;
    singleExactKey?: string;
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
    // Entries indexed by the keys of themselves restacked to one, so a captured
    // stack can be recognized as an existing item at a larger size.
    private readonly singleExactNamesByKey = Object.create(null) as Partial<
        Record<string, string[]>
    >;
    private readonly singleShellNamesByKey = Object.create(null) as Partial<
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
        const single = htsw.items.withItemCount(item.nbt, 1);
        let exactKey: string | undefined;
        let singleExactKey: string | undefined;
        if (this.identity === "shell") {
            exactKey = shellKey;
            singleExactKey = canonicalItemShellTagKey(single);
        } else if (expectedInteractData.kind === "absent") {
            exactKey = canonicalLiveItemTagKey(item.nbt);
            singleExactKey = canonicalLiveItemTagKey(single);
        }
        this.seed(
            item.name,
            shellKey,
            canonicalItemShellTagKey(single),
            exactKey,
            singleExactKey,
            displayNameFromTag(item.nbt),
            expectedInteractData
        );
    }

    seedNbtOnly(name: string, nbt: ImportableItem["nbt"]): void {
        const shellKey = canonicalItemShellTagKey(nbt);
        const single = htsw.items.withItemCount(nbt, 1);
        const singleShellKey = canonicalItemShellTagKey(single);
        const shell = this.identity === "shell";
        this.seed(
            name,
            shellKey,
            singleShellKey,
            shell ? shellKey : canonicalLiveItemTagKey(nbt),
            shell ? singleShellKey : canonicalLiveItemTagKey(single),
            displayNameFromTag(nbt),
            undefined
        );
    }

    private seed(
        name: string,
        shellKey: string,
        singleShellKey: string,
        exactKey: string | undefined,
        singleExactKey: string | undefined,
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
            singleShellKey,
            singleExactKey,
        };
        this.entriesByName[name] = entry;
        this.addName(this.shellNamesByKey, shellKey, name);
        this.addName(this.singleShellNamesByKey, singleShellKey, name);
        if (singleExactKey !== undefined) {
            this.addName(this.singleExactNamesByKey, singleExactKey, name);
        }
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

        // A stack that differs from a known item only in size is that item at a
        // larger count, not a new one. Emitting `name@<count>` keeps a house
        // that uses stack-count suffixes from exporting back into one duplicate
        // .snbt per size.
        const restacked = restackedToOne(normalizedSnbt);
        if (restacked !== undefined) {
            const base = this.matchRestacked(normalizedSnbt, restacked.snbt);
            if (base !== undefined) {
                this.capturedNames[base.name] = true;
                if (base.seeded) this.matchedNames[base.name] = true;
                return `${base.name}@${restacked.count}`;
            }
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
                this.reindexSingleKeys(changed, normalizedSnbt);
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

        const single = restackedSnbt(normalizedSnbt, 1);
        const singleShellKey = canonicalItemShellSnbtKey(single);
        const singleExactKey =
            this.identity === "shell"
                ? singleShellKey
                : canonicalLiveItemSnbtKey(single);
        this.entriesByName[name] = {
            name,
            snbt: normalizedSnbt,
            displayName: displayNameHint,
            seeded: false,
            shellKey,
            exactKey,
            singleShellKey,
            singleExactKey,
        };
        this.addName(this.shellNamesByKey, shellKey, name);
        this.addName(this.exactNamesByKey, exactKey, name);
        this.addName(this.singleShellNamesByKey, singleShellKey, name);
        this.addName(this.singleExactNamesByKey, singleExactKey, name);
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

    /**
     * The known item that `singleSnbt` — the captured stack restacked to one —
     * is a larger stack of, or undefined when it is a genuinely new item.
     *
     * Deliberately narrower than the matching `register` does for the stack as
     * captured: that code may adopt a lone same-shell candidate as an *edit* of
     * it and rewrite the entry. Restacking rewrites nothing, so a wrong guess
     * would silently point an action at an item with different click actions.
     * Only an identity match, or a cached click-action expectation that agrees,
     * is accepted.
     */
    private matchRestacked(
        originalSnbt: string,
        singleSnbt: string
    ): RegistryItem | undefined {
        const exactKey =
            this.identity === "shell"
                ? canonicalItemShellSnbtKey(singleSnbt)
                : canonicalLiveItemSnbtKey(singleSnbt);
        const exactName = this.singleExactNamesByKey[exactKey]?.[0];
        if (exactName !== undefined) return this.entriesByName[exactName];

        if (this.identity === "shell") return undefined;

        // A seeded item with click actions has no live key yet — its Housing
        // interact_data is only known from the cache — so fall back to the same
        // expectation check the exact-match path uses.
        const shellCandidates =
            this.singleShellNamesByKey[canonicalItemShellSnbtKey(singleSnbt)] ?? [];
        for (const name of shellCandidates) {
            const entry = this.entriesByName[name];
            if (entry?.seeded !== true) continue;
            const expected = entry.expectedInteractData;
            if (
                expected !== undefined &&
                itemInteractDataMatches(originalSnbt, expected)
            ) {
                return entry;
            }
        }
        return undefined;
    }

    /** Re-key an entry whose snbt was replaced by an edit captured this run. */
    private reindexSingleKeys(entry: RegistryItem, snbt: string): void {
        this.removeName(
            this.singleShellNamesByKey,
            entry.singleShellKey,
            entry.name
        );
        if (entry.singleExactKey !== undefined) {
            this.removeName(
                this.singleExactNamesByKey,
                entry.singleExactKey,
                entry.name
            );
        }

        const single = restackedSnbt(snbt, 1);
        entry.singleShellKey = canonicalItemShellSnbtKey(single);
        entry.singleExactKey =
            this.identity === "shell"
                ? entry.singleShellKey
                : canonicalLiveItemSnbtKey(single);
        this.addName(this.singleShellNamesByKey, entry.singleShellKey, entry.name);
        this.addName(this.singleExactNamesByKey, entry.singleExactKey, entry.name);
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

/** `snbt` restacked to `count`, or unchanged when it cannot be parsed. */
function restackedSnbt(snbt: string, count: number): string {
    const tag = parseItemSnbt(snbt);
    if (tag === undefined) return snbt;
    return htsw.nbt.printSnbt(htsw.items.withItemCount(tag, count), {
        pretty: false,
    });
}

/**
 * `snbt` restacked to a single item, plus the stack size it had. Undefined for
 * a stack of one (nothing to strip) and for a size outside what a `@<count>`
 * suffix can express, so an unrepresentable stack still exports as its own item.
 */
function restackedToOne(snbt: string): { snbt: string; count: number } | undefined {
    const tag = parseItemSnbt(snbt);
    if (tag === undefined) return undefined;
    const count = stackCountOf(tag);
    if (count === undefined || count === 1 || !htsw.items.isValidItemCount(count)) {
        return undefined;
    }
    return {
        snbt: htsw.nbt.printSnbt(htsw.items.withItemCount(tag, 1), {
            pretty: false,
        }),
        count,
    };
}

function parseItemSnbt(snbt: string): Tag | undefined {
    try {
        return htsw.nbt.parseSnbtText(snbt);
    } catch (_error) {
        return undefined;
    }
}

/** A missing `Count` is vanilla's default of one. */
function stackCountOf(tag: Tag): number | undefined {
    const count = tagChild(tag, "Count");
    if (count === undefined) return 1;
    if (count.type !== "byte" && count.type !== "short" && count.type !== "int") {
        return undefined;
    }
    return Number(count.value);
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
