import type { Action, Condition, Importable } from "htsw/types";

import type { TrustPlan } from "../../importCache";
import type { ItemDiffContext } from "./diff/itemDiffContext";
import type { ObservedActionSlot } from "../observedActions";
import type { CanonicalizeItemName, ResolveItemField } from "../items/itemReferences";
import type { ItemCaptureSink } from "../items/capture";
import type { ItemFieldObservationRecorder } from "../items/fieldObservations";
import type { SyncEventHandler } from "../syncEvents";
import type { OverwriteWarningMode } from "../../importables/overwriteWarning";

export type ActionSyncConflict = {
    type: Importable["type"];
    identity: string;
    basePath: string;
};

export function actionSyncConflictIdentifier(conflict: ActionSyncConflict): string {
    return `${conflict.type}:${conflict.identity}:${conflict.basePath}`;
}

export type ObservedConflictList =
    | { kind: "slots"; slots: readonly ObservedActionSlot[] }
    | { kind: "actions"; actions: readonly Action[] };

export type ActionSyncContext = {
    canonicalizeItemName: CanonicalizeItemName;
    resolveItem: ResolveItemField;
    trust: TrustPlan;
    overwriteWarningMode: OverwriteWarningMode;
    conflicts: ActionSyncConflict[];
    skippedConflicts?: ReadonlySet<string>;
    appliedActionLists?: Set<string>;
    observedConflictLists?: Map<string, ObservedConflictList>;
    events?: SyncEventHandler;
    itemRead: { mode: "sync" } | { mode: "verify"; captures: ItemCaptureSink };
    itemDiff?: ItemDiffContext;
    itemFieldObservations?: ItemFieldObservationRecorder;
    trustedItemOwners?: WeakSet<Action | Condition>;
    freshHydration?: boolean;
};
