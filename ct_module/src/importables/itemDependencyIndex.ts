import type { Action, Condition, Importable, ImportableItem } from "htsw/types";

import { canonicalStringify } from "../housingSync/fields/compare";
import { canonicalItemTag } from "../housingSync/fields/itemTagCanonical";
import { hashHex } from "../importCache/hash";
import { stableStringify } from "../utils/helpers";
import {
    type ItemReferenceUse,
    visitItemReferences,
} from "./itemDependencies";
import type { ItemRegistry, ItemRegistryEntry } from "./itemRegistry";

export type ItemDependencyTarget =
    | { kind: "named"; name: string }
    | { kind: "snbtPath"; path: string };

type CachedItemDependency = {
    target: ItemDependencyTarget;
    fingerprint: string;
};

export type ItemDependencySnapshot = {
    version: 1;
    dependencies: CachedItemDependency[];
};

type ItemDependencyCycle = {
    itemNames: string[];
};

export class ItemInvalidations {
    private readonly fields = new WeakMap<object, ReadonlySet<string>>();
    private readonly actionSubtrees = new WeakSet<Action>();
    public hasAny = false;

    public isFieldInvalidated(
        owner: Action | Condition,
        property: string
    ): boolean {
        return this.fields.get(owner)?.has(property) === true;
    }

    public hasInvalidatedSubtree(action: Action): boolean {
        return this.actionSubtrees.has(action);
    }

    public add(use: ItemReferenceUse): void {
        const existing = this.fields.get(use.owner);
        if (existing === undefined) {
            this.fields.set(use.owner, new Set([use.property]));
        } else if (!existing.has(use.property)) {
            const next = new Set(existing);
            next.add(use.property);
            this.fields.set(use.owner, next);
        }
        for (const action of use.actionAncestors) {
            this.actionSubtrees.add(action);
        }
        this.hasAny = true;
    }
}

export interface ItemDependencyIndex {
    readonly cycles: readonly ItemDependencyCycle[];
    snapshotOf(importable: Importable): ItemDependencySnapshot;
    invalidationsFor(
        importable: Importable,
        cached: ItemDependencySnapshot | undefined
    ): ItemInvalidations;
    fingerprintOf(entry: ItemRegistryEntry): string;
    fingerprintOfItem(item: ImportableItem): string | undefined;
    itemByName(name: string): ImportableItem | undefined;
    clickActionsFingerprint(item: ImportableItem): string;
}

const indexByImportable = new WeakMap<Importable, ItemDependencyIndex>();

export function itemDependencyIndexFor(
    importable: Importable
): ItemDependencyIndex | undefined {
    return indexByImportable.get(importable);
}

type ResolvedUse = {
    use: ItemReferenceUse;
    entry: ItemRegistryEntry;
    target: ItemDependencyTarget;
};

type GraphNode = {
    target: ItemDependencyTarget;
    nbt: string;
    leftClickActions?: string;
    rightClickActions?: string;
    references: ItemDependencyTarget[];
};

class DefaultItemDependencyIndex implements ItemDependencyIndex {
    public readonly cycles: ItemDependencyCycle[] = [];
    private readonly cycleKeys = new Set<string>();
    private readonly fingerprints = new Map<ItemRegistryEntry, string>();

    public constructor(
        importables: readonly Importable[],
        private readonly registry: ItemRegistry
    ) {
        for (const importable of importables) {
            if (importable.type !== "ITEM") continue;
            const entry = registry.get(importable.name);
            if (entry !== undefined) this.fingerprintOf(entry);
        }
    }

    public snapshotOf(importable: Importable): ItemDependencySnapshot {
        const byTarget = new Map<string, CachedItemDependency>();
        visitItemReferences(importable, use => {
            const resolved = this.resolveUse(use);
            if (resolved === undefined) return;
            const dependency: CachedItemDependency = {
                target: resolved.target,
                fingerprint: this.fingerprintOf(resolved.entry),
            };
            byTarget.set(targetKey(dependency.target), dependency);
        });
        const dependencies = Array.from(byTarget.values());
        dependencies.sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));
        return { version: 1, dependencies };
    }

    public invalidationsFor(
        importable: Importable,
        cached: ItemDependencySnapshot | undefined
    ): ItemInvalidations {
        const invalidations = new ItemInvalidations();
        const cachedFingerprints = new Map<string, string>();
        if (cached?.version === 1) {
            for (const dependency of cached.dependencies) {
                cachedFingerprints.set(
                    targetKey(dependency.target),
                    dependency.fingerprint
                );
            }
        }

        visitItemReferences(importable, use => {
            const resolved = this.resolveUse(use);
            if (resolved === undefined) {
                if (cached === undefined) invalidations.add(use);
                return;
            }
            const current = this.fingerprintOf(resolved.entry);
            if (cachedFingerprints.get(targetKey(resolved.target)) !== current) {
                invalidations.add(use);
            }
        });
        return invalidations;
    }

    public fingerprintOf(entry: ItemRegistryEntry): string {
        const cached = this.fingerprints.get(entry);
        if (cached !== undefined) return cached;
        const fingerprint = hashHex(stableStringify(this.graphFromEntries([entry])));
        this.fingerprints.set(entry, fingerprint);
        return fingerprint;
    }

    public fingerprintOfItem(item: ImportableItem): string | undefined {
        const entry = this.registry.get(item.name);
        return entry === undefined ? undefined : this.fingerprintOf(entry);
    }

    public itemByName(name: string): ImportableItem | undefined {
        return this.registry.get(name)?.importable;
    }

    public clickActionsFingerprint(item: ImportableItem): string {
        const roots = this.resolvedUsesOf(item);
        const graph = this.graphFromEntries(roots.map(root => root.entry));
        return "v2-" + hashHex(
            stableStringify({
                version: 1,
                leftClickActions: canonicalStringify(item.leftClickActions ?? []),
                rightClickActions: canonicalStringify(item.rightClickActions ?? []),
                dependencies: graph,
            })
        );
    }

    private graphFromEntries(entries: readonly ItemRegistryEntry[]): GraphNode[] {
        const nodes = new Map<string, GraphNode>();
        const activeKeys: string[] = [];
        const activeNames: string[] = [];

        const collect = (entry: ItemRegistryEntry): void => {
            const target = targetOfEntry(entry);
            const key = targetKey(target);
            const activeIndex = activeKeys.indexOf(key);
            if (activeIndex >= 0) {
                this.recordCycle(activeNames.slice(activeIndex).concat(entry.name));
                return;
            }
            if (nodes.has(key)) return;

            const importable = entry.importable;
            const uses = importable === undefined ? [] : this.resolvedUsesOf(importable);
            const references = uses.map(resolved => resolved.target);
            references.sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
            nodes.set(key, {
                target,
                nbt: stableStringify(canonicalItemTag(entry.nbt)),
                leftClickActions:
                    importable === undefined
                        ? undefined
                        : canonicalStringify(importable.leftClickActions ?? []),
                rightClickActions:
                    importable === undefined
                        ? undefined
                        : canonicalStringify(importable.rightClickActions ?? []),
                references,
            });

            activeKeys.push(key);
            activeNames.push(entry.name);
            for (const use of uses) collect(use.entry);
            activeKeys.pop();
            activeNames.pop();
        };

        for (const entry of entries) collect(entry);
        const result = Array.from(nodes.values());
        result.sort((a, b) => targetKey(a.target).localeCompare(targetKey(b.target)));
        return result;
    }

    private resolvedUsesOf(importable: Importable): ResolvedUse[] {
        const result: ResolvedUse[] = [];
        visitItemReferences(importable, use => {
            const resolved = this.resolveUse(use);
            if (resolved !== undefined) result.push(resolved);
        });
        return result;
    }

    private resolveUse(use: ItemReferenceUse): ResolvedUse | undefined {
        const entry =
            this.registry.resolveFromSourcePath(
                use.itemName,
                use.sourcePath,
                use.owner
            ) ??
            this.registry.resolve(use.itemName, use.owner);
        if (entry === undefined) return undefined;
        return { use, entry, target: targetOfEntry(entry) };
    }

    private recordCycle(itemNames: string[]): void {
        const ring = itemNames.slice(0, -1);
        let canonical = ring;
        let canonicalKey = ring.join("\u0000");
        for (let i = 1; i < ring.length; i++) {
            const rotated = ring.slice(i).concat(ring.slice(0, i));
            const rotatedKey = rotated.join("\u0000");
            if (rotatedKey < canonicalKey) {
                canonical = rotated;
                canonicalKey = rotatedKey;
            }
        }
        const key = canonicalKey;
        if (this.cycleKeys.has(key)) return;
        this.cycleKeys.add(key);
        this.cycles.push({ itemNames: canonical.concat(canonical[0]) });
    }
}

function targetOfEntry(entry: ItemRegistryEntry): ItemDependencyTarget {
    return entry.source === "named"
        ? { kind: "named", name: entry.name }
        : { kind: "snbtPath", path: entry.path as string };
}

function targetKey(target: ItemDependencyTarget): string {
    return stableStringify(target);
}

export function createItemDependencyIndex(
    importables: readonly Importable[],
    registry: ItemRegistry
): ItemDependencyIndex {
    const index = new DefaultItemDependencyIndex(importables, registry);
    registry.itemDependencies = index;
    for (const importable of importables) {
        indexByImportable.set(importable, index);
    }
    return index;
}
