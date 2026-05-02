import { items as itemReferences, type GlobalCtxt } from "htsw";
import type { Importable, ImportableItem } from "htsw/types";

import TaskContext from "../tasks/context";
import { getCurrentHousingUuid } from "../knowledge";
import { removedFormatting, unique } from "../utils/helpers";
import { getItemFromNbt, readItemDisplayAliases } from "../utils/nbt";

export interface ItemRegistryEntry {
    name: string;
    item: Item;
    aliases: string[];
    source: "named" | "snbtPath";
    importable?: ImportableItem;
    path?: string;
}

export interface ItemRegistry {
    get(name: string): ItemRegistryEntry | undefined;
    resolve(name: string, ownerNode?: object): ItemRegistryEntry | undefined;
    canonicalizeObservedName(name: string): string;

    /**
     * Lazy memo for the current housing UUID, set by callers that have a
     * TaskContext available. Keeping it here means cache-backed item
     * resolvers (GIVE_ITEM, REQUIRE_ITEM, ...) avoid re-running `/wtfmap`
     * for every action in a sync. See `getMemoizedHousingUuid` below.
     */
    cachedHousingUuid: string | undefined;
}

class DefaultItemRegistry implements ItemRegistry {
    private readonly byName: Record<string, ItemRegistryEntry> = {};
    private readonly aliases: Record<string, ItemRegistryEntry | "ambiguous"> = {};
    private readonly directByOwnerPath: Record<string, ItemRegistryEntry> = {};
    private readonly itemNames = new Map<string, ImportableItem>();
    private readonly gcx?: GlobalCtxt;

    public cachedHousingUuid: string | undefined = undefined;

    public constructor(
        importables: readonly Importable[],
        gcx?: GlobalCtxt
    ) {
        this.gcx = gcx;

        for (const importable of importables) {
            if (importable.type !== "ITEM") {
                continue;
            }

            this.itemNames.set(importable.name, importable);
            const aliases = uniqueAliases([
                importable.name,
                removedFormatting(importable.name).trim(),
                ...readItemDisplayAliases(importable.nbt),
            ]);
            const entry: ItemRegistryEntry = {
                name: importable.name,
                importable,
                item: getItemFromNbt(importable.nbt),
                aliases,
                source: "named",
            };

            this.byName[entry.name] = entry;
            for (const alias of aliases) {
                if (alias === entry.name) {
                    continue;
                }

                const existing = this.aliases[alias];
                this.aliases[alias] =
                    existing === undefined || existing === entry ? entry : "ambiguous";
            }
        }
    }

    public get(name: string): ItemRegistryEntry | undefined {
        return this.byName[name];
    }

    public resolve(name: string, ownerNode?: object): ItemRegistryEntry | undefined {
        const named = this.get(name);
        if (named !== undefined) {
            return named;
        }

        if (
            this.gcx === undefined ||
            ownerNode === undefined ||
            !itemReferences.isDirectSnbtItemReference(name)
        ) {
            return undefined;
        }

        const resolvedPath = itemReferences.resolveItemPathFromOwner(
            this.gcx,
            ownerNode,
            name
        );
        const existing = this.directByOwnerPath[resolvedPath];
        if (existing !== undefined) {
            return existing;
        }

        const resolved = itemReferences.resolveItemReference(
            this.gcx,
            this.itemNames,
            ownerNode,
            name
        );
        if (resolved === undefined || resolved.kind !== "snbtPath") {
            return undefined;
        }

        const entry: ItemRegistryEntry = {
            name,
            item: getItemFromNbt(resolved.nbt),
            aliases: uniqueAliases(readItemDisplayAliases(resolved.nbt)),
            source: "snbtPath",
            path: resolved.path,
        };
        this.directByOwnerPath[resolved.path] = entry;
        return entry;
    }

    public canonicalizeObservedName(name: string): string {
        const exact = this.get(name);
        if (exact !== undefined) {
            return exact.name;
        }

        const normalized = removedFormatting(name).trim();
        const alias = this.aliases[normalized] ?? this.aliases[name];
        return alias === undefined || alias === "ambiguous" ? name : alias.name;
    }
}

export function createItemRegistry(
    importables: readonly Importable[],
    gcx?: GlobalCtxt
): ItemRegistry {
    return new DefaultItemRegistry(importables, gcx);
}

/**
 * Resolve and memoize the current housing UUID on the registry. Used by
 * cache-backed item resolvers so a single sync run does at most one
 * `/wtfmap` round trip regardless of how many GIVE_ITEM/REQUIRE_ITEM/etc.
 * fields it touches.
 */
export async function getMemoizedHousingUuid(
    ctx: TaskContext,
    registry: ItemRegistry
): Promise<string> {
    const cached = registry.cachedHousingUuid;
    if (cached !== undefined) {
        return cached;
    }
    const uuid = await getCurrentHousingUuid(ctx);
    registry.cachedHousingUuid = uuid;
    return uuid;
}

function uniqueAliases(values: readonly string[]): string[] {
    const trimmed: string[] = [];
    for (const value of values) {
        const t = value.trim();
        if (t !== "") trimmed.push(t);
    }
    return unique(trimmed);
}
