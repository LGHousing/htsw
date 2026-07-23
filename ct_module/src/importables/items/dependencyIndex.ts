import type { Action, Condition, Importable, ImportableItem } from "htsw/types";

import { actionListCompareKey } from "../../housingSync/actions/comparison";
import { canonicalItemShellTagKey } from "../../housingSync/items/itemNbt";
import { hashHex } from "../../utils/hash";
import { stableStringify } from "../../utils/helpers";
import { type ItemReferenceUse, visitItemReferences } from "./dependencies";
import type { ProjectItemIndex, ProjectItem } from "./projectItems";

export type ItemDependencyTarget =
    { kind: "named"; name: string } | { kind: "snbtPath"; path: string };

type CachedItemDependency = {
    target: ItemDependencyTarget;
    fingerprint: string;
};

export type ItemDependencySnapshot = {
    version: 1;
    dependencies: CachedItemDependency[];
};

function validItemDependencySnapshot(
    value: ItemDependencySnapshot | undefined
): ItemDependencySnapshot | null | undefined {
    if (value === undefined) return undefined;
    const candidate = value as unknown as {
        version?: unknown;
        dependencies?: unknown;
    };
    if (candidate.version !== 1 || !Array.isArray(candidate.dependencies)) {
        return null;
    }
    return value;
}

export function sameItemDependencySnapshot(
    left: ItemDependencySnapshot | undefined,
    right: ItemDependencySnapshot | undefined
): boolean {
    const validLeft = validItemDependencySnapshot(left);
    const validRight = validItemDependencySnapshot(right);
    if (validLeft === null || validRight === null) return false;
    const leftDependencies = validLeft?.dependencies ?? [];
    const rightDependencies = validRight?.dependencies ?? [];
    if (leftDependencies.length !== rightDependencies.length) return false;
    for (let i = 0; i < leftDependencies.length; i++) {
        const a = leftDependencies[i];
        const b = rightDependencies[i];
        if (
            a.fingerprint !== b.fingerprint ||
            a.target.kind !== b.target.kind ||
            (a.target.kind === "named"
                ? a.target.name !== (b.target as { kind: "named"; name: string }).name
                : a.target.path !==
                  (b.target as { kind: "snbtPath"; path: string }).path)
        ) {
            return false;
        }
    }
    return true;
}

type ItemDependencyCycle = {
    itemNames: string[];
};

export class ItemInvalidations {
    private readonly fields = new WeakMap<object, ReadonlySet<string>>();
    private readonly actionSubtrees = new WeakSet<Action>();
    public hasAny = false;

    public isFieldInvalidated(owner: Action | Condition, property: string): boolean {
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
    fingerprintOf(entry: ProjectItem): string;
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
    entry: ProjectItem;
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
    private readonly fingerprints = new Map<ProjectItem, string>();
    private readonly graphNodes = new Map<string, GraphNode>();
    private readonly graphEntries = new Map<string, readonly ProjectItem[]>();
    private readonly clickActionFingerprints = new WeakMap<ImportableItem, string>();
    private readonly snapshots = new WeakMap<object, ItemDependencySnapshot>();

    public constructor(
        importables: readonly Importable[],
        private readonly projectItems: ProjectItemIndex
    ) {
        for (const importable of importables) {
            if (importable.type !== "ITEM") continue;
            const entry = projectItems.get(importable.name);
            if (entry !== undefined) this.fingerprintOf(entry);
        }
    }

    public snapshotOf(importable: Importable): ItemDependencySnapshot {
        const cached = this.snapshots.get(importable);
        if (cached !== undefined) return cached;
        const byTarget = new Map<string, CachedItemDependency>();
        visitItemReferences(importable, (use) => {
            const resolved = this.resolveUse(use);
            if (resolved === undefined) return;
            const dependency: CachedItemDependency = {
                target: resolved.target,
                fingerprint: this.fingerprintOf(resolved.entry),
            };
            byTarget.set(itemDependencyTargetKey(dependency.target), dependency);
        });
        const dependencies = Array.from(byTarget.values());
        dependencies.sort((a, b) =>
            itemDependencyTargetKey(a.target).localeCompare(
                itemDependencyTargetKey(b.target)
            )
        );
        const snapshot: ItemDependencySnapshot = { version: 1, dependencies };
        this.snapshots.set(importable, snapshot);
        return snapshot;
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
                    itemDependencyTargetKey(dependency.target),
                    dependency.fingerprint
                );
            }
        }

        visitItemReferences(importable, (use) => {
            const resolved = this.resolveUse(use);
            if (resolved === undefined) {
                if (cached === undefined) invalidations.add(use);
                return;
            }
            const current = this.fingerprintOf(resolved.entry);
            if (
                cachedFingerprints.get(itemDependencyTargetKey(resolved.target)) !==
                current
            ) {
                invalidations.add(use);
            }
        });
        return invalidations;
    }

    public fingerprintOf(entry: ProjectItem): string {
        const cached = this.fingerprints.get(entry);
        if (cached !== undefined) return cached;
        const fingerprint = hashHex(stableStringify(this.graphFromEntries([entry])));
        this.fingerprints.set(entry, fingerprint);
        return fingerprint;
    }

    public fingerprintOfItem(item: ImportableItem): string | undefined {
        const entry = this.projectItems.get(item.name);
        return entry === undefined ? undefined : this.fingerprintOf(entry);
    }

    public itemByName(name: string): ImportableItem | undefined {
        return this.projectItems.get(name)?.importable;
    }

    public clickActionsFingerprint(item: ImportableItem): string {
        const cached = this.clickActionFingerprints.get(item);
        if (cached !== undefined) return cached;
        const roots = this.resolvedUsesOf(item);
        const graph = this.graphFromEntries(roots.map((root) => root.entry));
        const fingerprint =
            "v2-" +
            hashHex(
                stableStringify({
                    version: 1,
                    leftClickActions: actionListCompareKey(item.leftClickActions ?? []),
                    rightClickActions: actionListCompareKey(item.rightClickActions ?? []),
                    dependencies: graph,
                })
            );
        this.clickActionFingerprints.set(item, fingerprint);
        return fingerprint;
    }

    private graphFromEntries(entries: readonly ProjectItem[]): GraphNode[] {
        const reachedKeys = new Set<string>();
        const activeKeys: string[] = [];
        const activeNames: string[] = [];

        const collect = (entry: ProjectItem): void => {
            const target = targetOfEntry(entry);
            const key = itemDependencyTargetKey(target);
            const activeIndex = activeKeys.indexOf(key);
            if (activeIndex >= 0) {
                this.recordCycle(activeNames.slice(activeIndex).concat(entry.name));
                return;
            }
            if (reachedKeys.has(key)) return;
            reachedKeys.add(key);

            let childEntries = this.graphEntries.get(key);
            if (childEntries === undefined) {
                const importable = entry.importable;
                const uses =
                    importable === undefined ? [] : this.resolvedUsesOf(importable);
                const references = uses.map((resolved) => resolved.target);
                references.sort((a, b) =>
                    itemDependencyTargetKey(a).localeCompare(
                        itemDependencyTargetKey(b)
                    )
                );
                this.graphNodes.set(key, {
                    target,
                    nbt: canonicalItemShellTagKey(entry.nbt),
                    leftClickActions:
                        importable === undefined
                            ? undefined
                            : actionListCompareKey(importable.leftClickActions ?? []),
                    rightClickActions:
                        importable === undefined
                            ? undefined
                            : actionListCompareKey(importable.rightClickActions ?? []),
                    references,
                });
                childEntries = uses.map((use) => use.entry);
                this.graphEntries.set(key, childEntries);
            }

            activeKeys.push(key);
            activeNames.push(entry.name);
            for (const childEntry of childEntries) collect(childEntry);
            activeKeys.pop();
            activeNames.pop();
        };

        for (const entry of entries) collect(entry);
        const result = Array.from(reachedKeys, (key) => this.graphNodes.get(key) as GraphNode);
        result.sort((a, b) =>
            itemDependencyTargetKey(a.target).localeCompare(
                itemDependencyTargetKey(b.target)
            )
        );
        return result;
    }

    private resolvedUsesOf(importable: Importable): ResolvedUse[] {
        const result: ResolvedUse[] = [];
        visitItemReferences(importable, (use) => {
            const resolved = this.resolveUse(use);
            if (resolved !== undefined) result.push(resolved);
        });
        return result;
    }

    private resolveUse(use: ItemReferenceUse): ResolvedUse | undefined {
        const entry =
            this.projectItems.resolveFromSourcePath(
                use.itemName,
                use.sourcePath,
                use.owner
            ) ?? this.projectItems.resolve(use.itemName, use.owner);
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

function targetOfEntry(entry: ProjectItem): ItemDependencyTarget {
    return entry.source === "named"
        ? { kind: "named", name: entry.name }
        : { kind: "snbtPath", path: entry.path as string };
}

export function itemDependencyTargetKey(target: ItemDependencyTarget): string {
    return target.kind === "named"
        ? `named:${target.name}`
        : `snbtPath:${target.path}`;
}

const dependencyIndexByImportables = new WeakMap<object, ItemDependencyIndex>();
let itemDependencyIndexRevision = 0;

export function createItemDependencyIndex(
    importables: readonly Importable[],
    projectItems: ProjectItemIndex
): ItemDependencyIndex {
    const cached = dependencyIndexByImportables.get(importables);
    if (cached !== undefined) return cached;
    const index = new DefaultItemDependencyIndex(importables, projectItems);
    dependencyIndexByImportables.set(importables, index);
    for (const importable of importables) {
        indexByImportable.set(importable, index);
    }
    itemDependencyIndexRevision++;
    return index;
}

export function invalidateItemDependencyIndex(
    importables: readonly Importable[]
): void {
    if (!dependencyIndexByImportables.delete(importables)) return;
    for (const importable of importables) indexByImportable.delete(importable);
    itemDependencyIndexRevision++;
}

export function getItemDependencyIndexRevision(): number {
    return itemDependencyIndexRevision;
}
