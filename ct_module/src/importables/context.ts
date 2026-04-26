import type { Importable, ImportableItem } from "htsw/types";

import { removedFormatting } from "../utils/helpers";
import { getItemFromNbt, readItemDisplayAliases } from "../utils/nbt";

export interface ImportContext {
    items: ItemRegistry;
}

export interface ItemRegistryEntry {
    name: string;
    importable: ImportableItem;
    item: Item;
    aliases: string[];
}

export interface ItemRegistry {
    get(name: string): ItemRegistryEntry | undefined;
    resolve(name: string): ItemRegistryEntry | undefined;
    canonicalizeObservedName(name: string): string;
}

class DefaultItemRegistry implements ItemRegistry {
    private readonly byName: Record<string, ItemRegistryEntry> = {};
    private readonly aliases: Record<string, ItemRegistryEntry | "ambiguous"> = {};

    public constructor(importables: readonly Importable[]) {
        for (const importable of importables) {
            if (importable.type !== "ITEM") {
                continue;
            }

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

    public resolve(name: string): ItemRegistryEntry | undefined {
        const exact = this.get(name);
        if (exact !== undefined) {
            return exact;
        }

        const alias = this.aliases[name];
        return alias === "ambiguous" ? undefined : alias;
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

export function createImportContext(importables: readonly Importable[]): ImportContext {
    return {
        items: new DefaultItemRegistry(importables),
    };
}

function uniqueAliases(values: readonly string[]): string[] {
    const aliases: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (trimmed !== "" && aliases.indexOf(trimmed) === -1) {
            aliases.push(trimmed);
        }
    }
    return aliases;
}
