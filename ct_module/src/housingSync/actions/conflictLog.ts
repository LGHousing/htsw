/// <reference types="../../../CTAutocomplete" />

import type { Action } from "htsw/types";

import type { ActionSyncConflict } from "./syncContext";
import type { ObservedActionSlot } from "../observedActions";
import {
    actionListContentHashFromActions,
    actionListContentHashFromSlots,
    actionListScanHashFromActions,
    actionListScanHashFromSlots,
    actionListScanSlotsFromActions,
    actionListScanSlotsFromSlots,
} from "./scanHash";
import type { ItemFieldContent } from "../items/fieldContent";

const IMPORT_CONFLICT_LOG_PATH =
    "./config/ChatTriggers/modules/HTSW/import-conflicts.log";

/**
 * Every flagged conflict lands here with the exact evidence the verdict was
 * judged on: the hash triple (live house, house.lock.json baseline, source)
 * and the canonical type sequences for live vs source. Written at scan time
 * so the record exists even if the prompt is cancelled or the game closes.
 */
export function logActionListConflict(args: {
    target: ActionSyncConflict;
    hashFamily: "scan" | "content";
    live: { slots: readonly ObservedActionSlot[] } | { actions: readonly Action[] };
    lock: { contentHash: string | undefined; scanHash: string | undefined };
    source: readonly Action[];
    liveItemContent?: ItemFieldContent;
    sourceItemContent?: ItemFieldContent;
}): void {
    try {
        const liveScanHash =
            "slots" in args.live
                ? actionListScanHashFromSlots(args.live.slots)
                : actionListScanHashFromActions(args.live.actions);
        const liveContentHash =
            "slots" in args.live
                ? actionListContentHashFromSlots(args.live.slots, args.liveItemContent)
                : actionListContentHashFromActions(
                      args.live.actions,
                      args.liveItemContent
                  );
        const record = {
            at: new Date().toISOString(),
            target: args.target,
            hashFamily: args.hashFamily,
            liveScanHash,
            liveContentHash: liveContentHash ?? null,
            lockScanHash: args.lock.scanHash ?? null,
            lockContentHash: args.lock.contentHash ?? null,
            sourceScanHash: actionListScanHashFromActions(args.source),
            sourceContentHash: actionListContentHashFromActions(
                args.source,
                args.sourceItemContent
            ),
            liveTypes:
                "slots" in args.live
                    ? actionListScanSlotsFromSlots(args.live.slots)
                    : actionListScanSlotsFromActions(args.live.actions),
            sourceTypes: actionListScanSlotsFromActions(args.source),
        };
        FileLib.append(IMPORT_CONFLICT_LOG_PATH, JSON.stringify(record) + "\n");
    } catch (_e) {
        // diagnostics must never take the import down
    }
}
