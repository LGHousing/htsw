import type { Action, Condition, Importable } from "htsw/types";

import type { ItemDiffContext } from "../../housingSync/actions/diff/itemDiffContext";
import type { ItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { ACTION_MAPPINGS } from "../../housingSync/fields/actionMappings";
import type {
    ItemDependencyIndex,
    ItemDependencySnapshot,
    ItemInvalidations,
} from "./dependencyIndex";
import { visitItemReferences } from "./dependencies";
import type { ProjectItemIndex, ProjectItem } from "./projectItems";
import {
    itemFieldInteractDataWarning,
    itemFieldObservationMatches,
} from "./observationMatches";
import type { ItemVerificationTracker } from "./verifiedDependencies";

type DesiredItemFields = Map<string, ProjectItem>;

export function createItemDiffContext(
    importables: readonly Importable[],
    dependencies: ItemDependencyIndex,
    projectItems: ProjectItemIndex,
    housingUuid: string | undefined,
    cachedSnapshotOf: (importable: Importable) => ItemDependencySnapshot | undefined,
    observations?: ItemFieldObservationRecorder,
    verification?: ItemVerificationTracker
): ItemDiffContext {
    const invalidations: ItemInvalidations[] = [];
    const desiredFields = new WeakMap<Action | Condition, DesiredItemFields>();
    const warningDetails = new Set<string>();

    for (const importable of importables) {
        invalidations.push(
            dependencies.invalidationsFor(importable, cachedSnapshotOf(importable))
        );
        visitItemReferences(importable, (use) => {
            const entry =
                projectItems.resolveFromSourcePath(
                    use.itemName,
                    use.sourcePath,
                    use.owner
                ) ?? projectItems.resolve(use.itemName, use.owner);
            if (entry === undefined) return;
            let fields = desiredFields.get(use.owner);
            if (fields === undefined) {
                fields = new Map();
                desiredFields.set(use.owner, fields);
            }
            fields.set(use.property, entry);
        });
    }

    const desiredActionIsInvalidated = (action: Action): boolean => {
        for (const invalidation of invalidations) {
            if (invalidation.hasInvalidatedSubtree(action)) return true;
        }
        return false;
    };

    const desiredConditionIsInvalidated = (condition: Condition): boolean => {
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
        verification?.recordPair(desired, observed as Action | Condition);
        const warnings = fieldWarnings(observed as Action | Condition, desired);
        for (const warning of warnings) warningDetails.add(warning);
        if (observations === undefined) return false;
        const fields = desiredFields.get(desired);
        if (fields === undefined) return false;
        for (const [property, entry] of fields) {
            if (
                !itemFieldObservationMatches(
                    observations,
                    observed as Action | Condition,
                    property,
                    entry,
                    dependencies,
                    housingUuid
                )
            ) {
                return true;
            }
        }
        return false;
    };

    const fieldWarnings = (
        observed: Action | Condition,
        desired: Action | Condition
    ): string[] => {
        if (observations === undefined) return [];
        const fields = desiredFields.get(desired);
        if (fields === undefined) return [];
        const warnings: string[] = [];
        for (const [property, entry] of fields) {
            const warning = itemFieldInteractDataWarning(
                observations,
                observed,
                property,
                entry,
                dependencies,
                housingUuid
            );
            if (warning !== undefined) warnings.push(warning);
        }
        return warnings;
    };

    const actionSubtreeObservedItemsDiffer = (
        observed: object,
        desired: Action
    ): boolean => {
        if (observedFieldsDiffer(observed, desired)) return true;
        const fields = (
            ACTION_MAPPINGS as unknown as Partial<
                Record<
                    string,
                    { loreFields: Record<string, { prop: string; kind: string }> }
                >
            >
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
        hasActionList(actions) {
            for (const action of actions) {
                if (desiredActionIsInvalidated(action)) return true;
            }
            return false;
        },
        actionsDiffer(observed, desired) {
            return (
                desiredActionIsInvalidated(desired) ||
                actionSubtreeObservedItemsDiffer(observed, desired)
            );
        },
        conditionsDiffer(observed, desired) {
            return (
                desiredConditionIsInvalidated(desired) ||
                (observed !== null && observedFieldsDiffer(observed, desired))
            );
        },
        fieldWarnings,
        warningDetails() {
            return Array.from(warningDetails);
        },
    };
}
