import type { Action } from "htsw/types";

import type { ObservedActionSlot } from "../observedActions";
import {
    actionListContentHashFromActions,
    actionListContentHashFromSlots,
    actionListScanHashFromActions,
    actionListScanHashFromSlots,
} from "./scanHash";

export function scanConflictVerdict(
    liveHash: string,
    lockHash: string | undefined,
    sourceHash: string
): "no-baseline" | "unchanged" | "already-applied" | "conflict" {
    if (lockHash === undefined) return "no-baseline";
    if (liveHash === lockHash) return "unchanged";
    if (liveHash === sourceHash) return "already-applied";
    return "conflict";
}

export type ActionListConflictVerdict = ReturnType<typeof scanConflictVerdict>;

type LiveActionList =
    { slots: readonly ObservedActionSlot[] } | { actions: readonly Action[] };

export function actionListConflictVerdict(
    live: LiveActionList,
    lock: {
        contentHash: string | undefined;
        scanHash: string | undefined;
    },
    source: readonly Action[],
    hashFamily: "scan" | "content"
): ActionListConflictVerdict | null {
    if (hashFamily === "scan") {
        return scanConflictVerdict(
            "slots" in live
                ? actionListScanHashFromSlots(live.slots)
                : actionListScanHashFromActions(live.actions),
            lock.scanHash,
            actionListScanHashFromActions(source)
        );
    }

    const liveContentHash =
        "slots" in live
            ? actionListContentHashFromSlots(live.slots)
            : actionListContentHashFromActions(live.actions);
    if (liveContentHash === undefined) return null;
    if (lock.contentHash !== undefined || lock.scanHash === undefined) {
        return scanConflictVerdict(
            liveContentHash,
            lock.contentHash,
            actionListContentHashFromActions(source)
        );
    }
    return scanConflictVerdict(
        "slots" in live
            ? actionListScanHashFromSlots(live.slots)
            : actionListScanHashFromActions(live.actions),
        lock.scanHash,
        actionListScanHashFromActions(source)
    );
}
