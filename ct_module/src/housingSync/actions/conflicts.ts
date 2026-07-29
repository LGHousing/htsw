import type { Action } from "htsw/types";

import type { ObservedActionSlot } from "../observedActions";
import {
    actionListContentHashFromActions,
    actionListContentHashFromSlots,
    actionListScanHashFromActions,
    actionListScanHashFromSlots,
} from "./scanHash";
import type { ItemFieldContent } from "../items/fieldContent";

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

export type ActionListComparison = {
    verdict: ActionListConflictVerdict;
    sourceDiffersFromLive: boolean;
};

function compareHashes(
    liveHash: string,
    lockHash: string | undefined,
    sourceHash: string
): ActionListComparison {
    return {
        verdict: scanConflictVerdict(liveHash, lockHash, sourceHash),
        sourceDiffersFromLive: liveHash !== sourceHash,
    };
}

export function compareActionList(
    live: LiveActionList,
    lock: {
        contentHash: string | undefined;
        scanHash: string | undefined;
    },
    source: readonly Action[],
    hashFamily: "scan" | "content",
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): ActionListComparison | null {
    if (hashFamily === "scan") {
        return compareHashes(
            "slots" in live
                ? actionListScanHashFromSlots(live.slots)
                : actionListScanHashFromActions(live.actions),
            lock.scanHash,
            actionListScanHashFromActions(source)
        );
    }

    const sourceContentHash = actionListContentHashFromActions(
        source,
        sourceItemContent
    );
    const liveContentHash =
        "slots" in live
            ? actionListContentHashFromSlots(live.slots, liveItemContent)
            : actionListContentHashFromActions(live.actions, liveItemContent);
    if (liveContentHash === undefined) return null;
    const verdict =
        lock.contentHash !== undefined || lock.scanHash === undefined
            ? scanConflictVerdict(
                  liveContentHash,
                  lock.contentHash,
                  sourceContentHash
              )
            : scanConflictVerdict(
                  "slots" in live
                      ? actionListScanHashFromSlots(live.slots)
                      : actionListScanHashFromActions(live.actions),
                  lock.scanHash,
                  actionListScanHashFromActions(source)
              );
    return {
        verdict,
        sourceDiffersFromLive: liveContentHash !== sourceContentHash,
    };
}

export function actionListConflictVerdict(
    live: LiveActionList,
    lock: {
        contentHash: string | undefined;
        scanHash: string | undefined;
    },
    source: readonly Action[],
    hashFamily: "scan" | "content",
    liveItemContent?: ItemFieldContent,
    sourceItemContent?: ItemFieldContent
): ActionListConflictVerdict | null {
    return (
        compareActionList(
            live,
            lock,
            source,
            hashFamily,
            liveItemContent,
            sourceItemContent
        )?.verdict ?? null
    );
}
