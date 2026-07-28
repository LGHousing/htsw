import type { Importable } from "htsw/types";

import { fullyHydratedActionsFromSlots } from "../../housingSync/actions/hydration/plan";
import {
    actionSyncConflictIdentifier,
    type ObservedConflictList,
} from "../../housingSync/actions/syncContext";
import { setImportableActionList } from "../../importCache/actionLists";
import { importableIdentity } from "../identity";
import type {
    ImportConflict,
    ImportConflictPolicy,
} from "./conflicts";

export type ImportConflictResolution = {
    accepted: ImportConflict[];
    skipped: ImportConflict[];
};

export function resolveSelectedImportConflicts(
    conflicts: readonly ImportConflict[],
    acceptedIdentifiers: ReadonlySet<string>
): ImportConflictResolution {
    const accepted: ImportConflict[] = [];
    const skipped: ImportConflict[] = [];
    for (const conflict of conflicts) {
        if (acceptedIdentifiers.has(actionSyncConflictIdentifier(conflict))) {
            accepted.push(conflict);
        } else {
            skipped.push(conflict);
        }
    }
    return { accepted, skipped };
}

function conflictImportableIdentifier(conflict: ImportConflict): string {
    return `${conflict.type}:${conflict.identity}`;
}

export function resolveImportConflicts(
    conflicts: readonly ImportConflict[],
    accepts: readonly string[]
): ImportConflictResolution {
    const acceptedKeys = new Set<string>();
    for (const identifier of accepts) {
        const matches = conflicts.filter(
            (conflict) =>
                conflictImportableIdentifier(conflict) === identifier ||
                actionSyncConflictIdentifier(conflict) === identifier
        );
        if (matches.length === 0) {
            const actual = conflicts.map(actionSyncConflictIdentifier).join(", ");
            throw new Error(
                `--accept did not match any conflicted list: ${identifier}` +
                    (actual.length === 0 ? "" : ` (conflicts: ${actual})`)
            );
        }
        for (const conflict of matches) {
            acceptedKeys.add(actionSyncConflictIdentifier(conflict));
        }
    }
    return resolveSelectedImportConflicts(conflicts, acceptedKeys);
}

export type ImportConflictPolicyDecision =
    | { kind: "resolved"; resolution: ImportConflictResolution }
    | { kind: "cancel" }
    | { kind: "prompt"; resolution: ImportConflictResolution };

export function resolveImportConflictPolicy(
    conflicts: readonly ImportConflict[],
    accepts: readonly string[],
    policy: ImportConflictPolicy
): ImportConflictPolicyDecision {
    const resolution = resolveImportConflicts(conflicts, accepts);
    if (resolution.skipped.length === 0 || policy === "skip") {
        return { kind: "resolved", resolution };
    }
    return policy === "cancel"
        ? { kind: "cancel" }
        : { kind: "prompt", resolution };
}

export function importableWithSkippedConflictLists(
    desired: Importable,
    skipped: readonly ImportConflict[],
    observedLists: ReadonlyMap<string, ObservedConflictList>
): Importable {
    if (skipped.length === 0) return desired;
    const relevant = skipped.filter(
        (conflict) =>
            conflict.type === desired.type &&
            conflict.identity === importableIdentity(desired)
    );
    if (relevant.length === 0) return desired;
    const result = JSON.parse(JSON.stringify(desired)) as Importable;
    for (const conflict of relevant) {
        const identifier = actionSyncConflictIdentifier(conflict);
        const observed = observedLists.get(identifier);
        const actions =
            observed === undefined
                ? null
                : observed.kind === "actions"
                  ? observed.actions.slice()
                  : fullyHydratedActionsFromSlots(observed.slots);
        if (actions === null) {
            throw new Error(
                `Cannot skip conflicted list ${identifier}: its live contents could not be read completely.`
            );
        }
        if (!setImportableActionList(result, conflict.basePath, actions)) {
            throw new Error(`Cannot persist skipped conflicted list ${identifier}.`);
        }
    }
    return result;
}
