import { items as itemReferences, type GlobalCtxt } from "htsw";
import type { Tag } from "htsw/nbt";
import {
    type Importable,
    type ImportableItem,
} from "htsw/types";

import { canonicalVanillaItemCompareName } from "../../housingSync/items/itemReferences";
import { removedFormatting, unique } from "../../utils/helpers";
import { getItemFromNbt, readItemDisplayAliases } from "../../utils/nbt";

export interface ProjectItem {
    name: string;
    readonly item: Item;
    nbt: Tag;
    aliases: string[];
    source: "named" | "snbtPath" | "vanilla";
    importable?: ImportableItem;
    path?: string;
    count?: number;
    base?: ProjectItem;
}

export interface ProjectItemIndex {
    get(name: string): ProjectItem | undefined;
    resolve(name: string, ownerNode?: object): ProjectItem | undefined;
    resolveFromSourcePath(
        name: string,
        sourcePath?: string,
        ownerNode?: object
    ): ProjectItem | undefined;
    canonicalizeObservedName(name: string): string;
}

class DefaultProjectItemIndex implements ProjectItemIndex {
    private readonly byName: Partial<Record<string, ProjectItem>> = {};
    private readonly aliases: Partial<Record<string, ProjectItem | "ambiguous">> = {};
    private readonly directByOwnerPath: Partial<Record<string, ProjectItem>> = {};
    private readonly vanillaById: Partial<Record<string, ProjectItem>> = {};
    private readonly directByOwner = new WeakMap<object, Map<string, ProjectItem>>();
    private readonly countedByEntry = new WeakMap<ProjectItem, Map<number, ProjectItem>>();
    private readonly itemNames = new Map<string, ImportableItem>();
    private readonly gcx?: GlobalCtxt;

    public constructor(importables: readonly Importable[], gcx?: GlobalCtxt) {
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
            const entry = projectItem({
                name: importable.name,
                importable,
                nbt: importable.nbt,
                aliases,
                source: "named",
            });

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

    public get(name: string): ProjectItem | undefined {
        return this.byName[name];
    }

    public resolve(name: string, ownerNode?: object): ProjectItem | undefined {
        const { base, count } = itemReferences.parseItemReferenceParts(name);
        return this.withCount(this.resolveBase(base, ownerNode), name, count);
    }

    private resolveBase(name: string, ownerNode?: object): ProjectItem | undefined {
        const named = this.get(name);
        if (named !== undefined) {
            return named;
        }

        if (ownerNode !== undefined) {
            const bound = this.directByOwner.get(ownerNode)?.get(name);
            if (bound !== undefined) return bound;
        }

        const vanilla = this.resolveVanilla(name);
        if (vanilla !== undefined) return vanilla;

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

        const entry = projectItem({
            name,
            nbt: resolved.nbt,
            aliases: uniqueAliases(readItemDisplayAliases(resolved.nbt)),
            source: "snbtPath",
            path: resolved.path,
        });
        this.directByOwnerPath[resolved.path] = entry;
        return entry;
    }

    public resolveFromSourcePath(
        name: string,
        sourcePath?: string,
        ownerNode?: object
    ): ProjectItem | undefined {
        const { base, count } = itemReferences.parseItemReferenceParts(name);
        return this.withCount(
            this.resolveBaseFromSourcePath(base, sourcePath, ownerNode),
            name,
            count
        );
    }

    private resolveBaseFromSourcePath(
        name: string,
        sourcePath?: string,
        ownerNode?: object
    ): ProjectItem | undefined {
        const named = this.get(name);
        if (named !== undefined) return named;
        const vanilla = this.resolveVanilla(name);
        if (vanilla !== undefined) {
            this.bindDirectOwner(ownerNode, name, vanilla);
            return vanilla;
        }
        if (
            this.gcx === undefined ||
            sourcePath === undefined ||
            !itemReferences.isDirectSnbtItemReference(name)
        ) {
            return undefined;
        }

        const resolvedPath = itemReferences.resolveItemPathFromSourcePath(
            this.gcx,
            sourcePath,
            name
        );
        const existing = this.directByOwnerPath[resolvedPath];
        if (existing !== undefined) {
            this.bindDirectOwner(ownerNode, name, existing);
            return existing;
        }

        const resolved = itemReferences.resolveItemReferenceFromSourcePath(
            this.gcx,
            this.itemNames,
            sourcePath,
            name
        );
        if (resolved === undefined || resolved.kind !== "snbtPath") return undefined;

        const entry = projectItem({
            name,
            nbt: resolved.nbt,
            aliases: uniqueAliases(readItemDisplayAliases(resolved.nbt)),
            source: "snbtPath",
            path: resolved.path,
        });
        this.directByOwnerPath[resolved.path] = entry;
        this.bindDirectOwner(ownerNode, name, entry);
        return entry;
    }

    private withCount(
        entry: ProjectItem | undefined,
        reference: string,
        count: number | undefined
    ): ProjectItem | undefined {
        if (entry === undefined) return entry;
        if (count === undefined || !itemReferences.isValidItemCount(count)) {
            return entry;
        }
        let byCount = this.countedByEntry.get(entry);
        if (byCount === undefined) {
            byCount = new Map();
            this.countedByEntry.set(entry, byCount);
        }
        const existing = byCount.get(count);
        if (existing !== undefined) return existing;
        const counted = projectItem({
            name: reference,
            nbt: itemReferences.withItemCount(entry.nbt, count),
            aliases: entry.aliases,
            source: entry.source,
            importable: entry.importable,
            path: entry.path,
            count,
            base: entry,
        });
        byCount.set(count, counted);
        return counted;
    }

    private resolveVanilla(name: string): ProjectItem | undefined {
        const existing = this.vanillaById[name];
        if (existing !== undefined) return existing;
        const resolved = itemReferences.resolveVanillaItemReference(name);
        if (resolved === undefined || resolved.kind !== "vanilla") {
            return undefined;
        }

        const aliases = uniqueAliases([
            canonicalVanillaItemCompareName(name),
            ...readItemDisplayAliases(resolved.nbt),
        ]);
        const entry = projectItem({
            name,
            nbt: resolved.nbt,
            aliases,
            source: "vanilla",
        });
        this.vanillaById[name] = entry;
        for (const alias of aliases) {
            const current = this.aliases[alias];
            this.aliases[alias] =
                current === undefined || current === entry ? entry : "ambiguous";
        }
        return entry;
    }

    private bindDirectOwner(
        ownerNode: object | undefined,
        name: string,
        entry: ProjectItem
    ): void {
        if (ownerNode === undefined) return;
        let entries = this.directByOwner.get(ownerNode);
        if (entries === undefined) {
            entries = new Map();
            this.directByOwner.set(ownerNode, entries);
        }
        entries.set(name, entry);
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

function projectItem(fields: Omit<ProjectItem, "item">): ProjectItem {
    let item: Item | undefined;
    return {
        ...fields,
        get item(): Item {
            if (item === undefined) item = getItemFromNbt(fields.nbt);
            return item;
        },
    };
}

export function createProjectItemIndex(
    importables: readonly Importable[],
    gcx?: GlobalCtxt
): ProjectItemIndex {
    const cached = projectItemIndexByImportables.get(importables);
    if (cached !== undefined) return cached;
    const index = new DefaultProjectItemIndex(importables, gcx);
    projectItemIndexByImportables.set(importables, index);
    return index;
}

const projectItemIndexByImportables = new WeakMap<object, ProjectItemIndex>();

export function invalidateProjectItemIndex(
    importables: readonly Importable[]
): void {
    projectItemIndexByImportables.delete(importables);
}

function uniqueAliases(values: readonly string[]): string[] {
    const trimmed: string[] = [];
    for (const value of values) {
        const t = value.trim();
        if (t !== "") trimmed.push(t);
    }
    return unique(trimmed);
}
