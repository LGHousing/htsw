import type { Action, Condition, Importable } from "htsw/types";

import type { TrustPlan } from "../../importCache";
import type { ItemDiffContext } from "./diff/itemDiffContext";
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

export type ActionSyncContext = {
    canonicalizeItemName: CanonicalizeItemName;
    resolveItem: ResolveItemField;
    trust: TrustPlan;
    overwriteWarningMode: OverwriteWarningMode;
    conflicts: ActionSyncConflict[];
    conflictTargets?: ActionSyncConflict[];
    skippedConflicts?: ReadonlySet<string>;
    observedConflictLists?: Map<string, readonly Action[]>;
    observedActionLists?: Map<string, readonly Action[]>;
    events?: SyncEventHandler;
    itemRead: { mode: "sync" } | { mode: "verify"; captures: ItemCaptureSink };
    itemDiff?: ItemDiffContext;
    itemFieldObservations?: ItemFieldObservationRecorder;
    trustedItemOwners?: WeakSet<Action | Condition>;
    freshHydration?: boolean;
};
