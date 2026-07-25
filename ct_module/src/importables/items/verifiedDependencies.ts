import type { Action, Condition, Importable } from "htsw/types";

import type { ItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { visitItemReferences } from "./dependencies";
import type {
    ItemDependencyIndex,
    ItemDependencySnapshot,
    ItemDependencyTarget,
} from "./dependencyIndex";
import { itemDependencyTargetKey } from "./dependencyIndex";
import { itemFieldObservationMatches } from "./observationMatches";
import type { ProjectItemIndex } from "./projectItems";

export type ItemVerificationTracker = {
    recordPair(
        desired: Action | Condition,
        observed: Action | Condition
    ): void;
    observedFor(desired: Action | Condition): Action | Condition | undefined;
};

export function createItemVerificationTracker(): ItemVerificationTracker {
    const observedByDesired = new WeakMap<
        Action | Condition,
        Action | Condition
    >();
    return {
        recordPair(desired, observed) {
            observedByDesired.set(desired, observed);
        },
        observedFor(desired) {
            return observedByDesired.get(desired);
        },
    };
}

export function verifiedItemDependencies(
    importable: Importable,
    dependencies: ItemDependencyIndex,
    projectItems: ProjectItemIndex,
    housingUuid: string,
    tracker: ItemVerificationTracker,
    observations: ItemFieldObservationRecorder | undefined,
    trustedOwners: { has(owner: Action | Condition): boolean },
    priorSnapshot: ItemDependencySnapshot | undefined
): ItemDependencySnapshot {
    const current = dependencies.snapshotOf(importable);
    const currentByTarget = new Map<string, ItemDependencySnapshot["dependencies"][number]>();
    for (const dependency of current.dependencies) {
        currentByTarget.set(itemDependencyTargetKey(dependency.target), dependency);
    }
    const priorByTarget = new Map<string, string>();
    for (const dependency of priorSnapshot?.dependencies ?? []) {
        priorByTarget.set(
            itemDependencyTargetKey(dependency.target),
            dependency.fingerprint
        );
    }
    const verified = new Map<string, boolean>();

    visitItemReferences(importable, (use) => {
        const entry =
            projectItems.resolveFromSourcePath(
                use.itemName,
                use.sourcePath,
                use.owner
            ) ?? projectItems.resolve(use.itemName, use.owner);
        if (entry === undefined) return;
        const target: ItemDependencyTarget =
            entry.source === "named"
                ? { kind: "named", name: entry.name }
                : entry.source === "vanilla"
                  ? { kind: "vanilla", id: entry.name }
                  : { kind: "snbtPath", path: entry.path as string };
        const dependency = currentByTarget.get(itemDependencyTargetKey(target));
        if (dependency === undefined) return;
        const key = itemDependencyTargetKey(dependency.target);
        const observed = tracker.observedFor(use.owner);
        const liveVerified =
            observed !== undefined &&
            itemFieldObservationMatches(
                observations,
                observed,
                use.property,
                entry,
                dependencies,
                housingUuid
            );
        const trustedVerified =
            observed !== undefined &&
            trustedOwners.has(observed) &&
            priorByTarget.get(key) === dependency.fingerprint;
        verified.set(key, (verified.get(key) ?? true) && (liveVerified || trustedVerified));
    });

    return {
        version: 1,
        dependencies: current.dependencies.filter(
            (dependency) =>
                verified.get(itemDependencyTargetKey(dependency.target)) === true
        ),
    };
}
