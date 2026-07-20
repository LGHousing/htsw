import type { Action, Condition, Importable } from "htsw/types";

import type { ItemDiffContext } from "../housingSync/actions/diff/itemDiffContext";
import { itemInteractDataMatches } from "../housingSync/itemCapture";
import { canonicalStringify } from "../housingSync/fields/compare";
import { canonicalItemTag } from "../housingSync/fields/itemTagCanonical";
import type { ItemFieldObservationRecorder } from "../housingSync/itemFieldObservations";
import { ACTION_MAPPINGS } from "../housingSync/fields/actionMappings";
import type { ItemDependencyIndex, ItemDependencySnapshot, ItemInvalidations } from "./itemDependencyIndex";
import { visitItemReferences } from "./itemDependencies";
import type { ItemRegistry, ItemRegistryEntry } from "./itemRegistry";
import { expectedInteractData } from "./items/interactDataCache";

type DesiredItemFields = Map<string, ItemRegistryEntry>;

export function createItemDiffContext(
    importables: readonly Importable[],
    dependencies: ItemDependencyIndex,
    registry: ItemRegistry,
    cachedSnapshotOf: (importable: Importable) => ItemDependencySnapshot | undefined,
    observations?: ItemFieldObservationRecorder
): ItemDiffContext {
    const invalidations: ItemInvalidations[] = [];
    const desiredFields = new WeakMap<Action | Condition, DesiredItemFields>();

    for (const importable of importables) {
        invalidations.push(
            dependencies.invalidationsFor(importable, cachedSnapshotOf(importable))
        );
        visitItemReferences(importable, use => {
            const entry =
                registry.resolveFromSourcePath(
                    use.itemName,
                    use.sourcePath,
                    use.owner
                ) ??
                registry.resolve(use.itemName, use.owner);
            if (entry === undefined) return;
            let fields = desiredFields.get(use.owner);
            if (fields === undefined) {
                fields = new Map();
                desiredFields.set(use.owner, fields);
            }
            fields.set(use.property, entry);
        });
    }

    const hasAction = (action: Action): boolean => {
        for (const invalidation of invalidations) {
            if (invalidation.hasInvalidatedSubtree(action)) return true;
        }
        return false;
    };

    const hasCondition = (condition: Condition): boolean => {
        const fields = desiredFields.get(condition);
        if (fields === undefined) return false;
        for (const property of fields.keys()) {
            for (const invalidation of invalidations) {
                if (invalidation.isFieldInvalidated(condition, property)) return true;
            }
        }
        return false;
    };

    const observedFieldsDiffer = (
        observed: object,
        desired: Action | Condition
    ): boolean => {
        if (observations === undefined) return false;
        const fields = desiredFields.get(desired);
        if (fields === undefined) return false;
        for (const [property, entry] of fields) {
            const observation = observations.get(
                observed as Action | Condition,
                property
            );
            if (
                observation === undefined ||
                observation.canonicalKey !== canonicalStringify(canonicalItemTag(entry.nbt))
            ) {
                return true;
            }
            const item = entry.importable;
            const expectation =
                item === undefined
                    ? { kind: "absent" as const }
                    : expectedInteractData(
                          item,
                          dependencies,
                          registry.cachedHousingUuid
                      );
            if (!itemInteractDataMatches(observation.snbt, expectation)) {
                return true;
            }
        }
        return false;
    };

    const actionSubtreeObservedItemsDiffer = (
        observed: object,
        desired: Action
    ): boolean => {
        if (observedFieldsDiffer(observed, desired)) return true;
        const fields = (
            ACTION_MAPPINGS as unknown as Partial<Record<
                string,
                { loreFields: Record<string, { prop: string; kind: string }> }
            >>
        )[desired.type]?.loreFields;
        if (fields === undefined) return false;
        const observedRecord = observed as Record<string, unknown>;
        const desiredRecord = desired as unknown as Record<string, unknown>;
        for (const label in fields) {
            const field = fields[label];
            const observedList = observedRecord[field.prop];
            const desiredList = desiredRecord[field.prop];
            if (!Array.isArray(observedList) || !Array.isArray(desiredList)) continue;
            const length = Math.min(observedList.length, desiredList.length);
            if (field.kind === "conditionList") {
                for (let i = 0; i < length; i++) {
                    if (
                        observedList[i] !== null &&
                        observedFieldsDiffer(
                            observedList[i] as object,
                            desiredList[i] as Condition
                        )
                    ) {
                        return true;
                    }
                }
            } else if (field.kind === "actionList") {
                for (let i = 0; i < length; i++) {
                    if (
                        observedList[i] !== null &&
                        actionSubtreeObservedItemsDiffer(
                            observedList[i] as object,
                            desiredList[i] as Action
                        )
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    return {
        hasAction,
        hasCondition,
        hasActionList(actions) {
            for (const action of actions) {
                if (hasAction(action)) return true;
            }
            return false;
        },
        actionsDiffer(observed, desired) {
            return (
                hasAction(desired) ||
                actionSubtreeObservedItemsDiffer(observed, desired)
            );
        },
        conditionsDiffer(observed, desired) {
            return (
                hasCondition(desired) ||
                (observed !== null && observedFieldsDiffer(observed, desired))
            );
        },
    };
}
