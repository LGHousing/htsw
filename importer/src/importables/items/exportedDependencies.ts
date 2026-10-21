import type { Importable } from "htsw/types";

import type {
    ItemDependencyIndex,
    ItemDependencySnapshot,
} from "./dependencyIndex";

export function exportedItemDependencies(
    importable: Importable,
    dependencies: ItemDependencyIndex,
    verifiedItemNames: ReadonlySet<string>
): ItemDependencySnapshot {
    const snapshot = dependencies.snapshotOf(importable);
    return {
        version: 1,
        dependencies: snapshot.dependencies.filter(
            (dependency) =>
                dependency.target.kind === "named" &&
                verifiedItemNames.has(dependency.target.name)
        ),
    };
}
