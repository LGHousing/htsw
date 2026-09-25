/// <reference types="../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { isAnyAutoTrackEnabled, getHousingUuid, isCurrentHouseTrusted } from "./state";
import { getActiveAutoTrackSources } from "./autoTrackScope";
import { canonicalPath, forEachCachedParse } from "./parsing/parses";
import { cachedStatusForImportable, statusForImportableBlocking } from "./cache-status";
import { shortPath } from "./lib/pathDisplay";
import {
    makeBulkQueueRow,
    makeImportableQueueRow,
    queueItemKey,
    reconcileAutoTrackedQueue,
    type QueueRow,
} from "./right-panel/import-tab/queue";
import { isQueueRunning } from "./right-panel/import-tab/queueRunner";
import { onImportableCacheWarm } from "./cache-status/cacheWarm";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { importableIdentity } from "../importables/identity";
import { getAutoRun } from "../settings";
import {
    hasPendingRemovals,
    isArmedForPrune,
    needsArmingScan,
    setOnArmingScansReset,
} from "../prune/projectRun";
import { autoRunRefresh } from "./autoRun";

/**
 * One tracked project's pending work. It queues as a single project row; the
 * importables inside are expanded when it runs, from the files as they are then.
 */
type ProjectPlan = {
    row: QueueRow | null;
    changed: number;
    complete: boolean;
    /** Queue keys of the importables the row would import, dependencies included. */
    workKeys: string[];
};

function importableStatus(
    imp: Importable,
    blockingCacheRead: boolean
): "current" | "modified" | "unknown" | null {
    return blockingCacheRead
        ? statusForImportableBlocking(imp)
        : cachedStatusForImportable(imp);
}

export function needsModifiedQueue(imp: Importable, blockingCacheRead = false): boolean {
    // "unknown" means no cache entry exists — a never-imported importable.
    // New importables must queue too, or auto-track never picks up newly
    // created functions/menus. (A cache that merely isn't loaded yet
    // returns null, not "unknown", and re-queues via the cache-warm event.)
    const status = importableStatus(imp, blockingCacheRead);
    return status === "modified" || status === "unknown";
}

function planProject(sourcePath: string, parsed: ImportablesParseResult): ProjectPlan {
    const canonicalSourcePath = canonicalPath(sourcePath);
    const house = parsed.importJson.houseUuid;
    const modified: Importable[] = [];
    let complete = true;
    for (const imp of parsed.value) {
        const status = importableStatus(imp, false);
        if (status === null) {
            complete = false;
        } else if (status === "modified" || status === "unknown") {
            modified.push(imp);
        }
    }
    const housingUuid = getHousingUuid();
    const expansion =
        housingUuid === null
            ? null
            : expandImportDependencies(parsed, modified, housingUuid, {
                  trustMode: isCurrentHouseTrusted(),
                  importJsonPath: canonicalSourcePath,
              });
    const work = expansion?.importables ?? modified;
    const workKeys = work.map(
        (importable) =>
            makeImportableQueueRow({
                op: "import",
                house,
                path: canonicalSourcePath,
                type: importable.type,
                identity: importableIdentity(importable),
            }).key
    );

    // A project that claims its whole house also has work when a save only
    // removed declarations, and once per auto-run session for its full scan.
    const removals =
        isArmedForPrune(parsed) &&
        ((getAutoRun() && needsArmingScan(canonicalSourcePath)) ||
            hasPendingRemovals(canonicalSourcePath, parsed));
    const row =
        work.length > 0 || removals
            ? makeBulkQueueRow({
                  op: "import",
                  house,
                  path: canonicalSourcePath,
                  scope: { kind: "file", path: canonicalSourcePath },
                  filter: "modified",
                  label: `Import ${shortPath(canonicalSourcePath)}`,
                  origin: "autotrack",
              })
            : null;
    return { row, changed: modified.length, complete, workKeys };
}

export type AutoTrackRefreshTrigger = "reparse" | "cacheWarm";

export function autoTrackRefresh(trigger: AutoTrackRefreshTrigger = "cacheWarm"): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getActiveAutoTrackSources();
    let changed = 0;
    let newlyQueuedChanged = 0;
    const detectedWorkKeys: string[] = [];
    const plans: ProjectPlan[] = [];
    const seenTracked = new Set<string>();
    let reconciliationComplete = true;
    forEachCachedParse((entry) => {
        if (!tracked.has(entry.canonicalPath)) return;
        seenTracked.add(entry.canonicalPath);
        if (entry.parsed === null) {
            reconciliationComplete = false;
            return;
        }
        const plan = planProject(entry.canonicalPath, entry.parsed);
        plans.push(plan);
        if (!plan.complete) reconciliationComplete = false;
        changed += plan.changed;
        for (const key of plan.workKeys) detectedWorkKeys.push(key);
    });
    if (seenTracked.size !== tracked.size) reconciliationComplete = false;

    const desiredItems: QueueRow[] = [];
    for (const plan of plans) {
        if (plan.row !== null) desiredItems.push(plan.row);
    }
    // A save is the signal to try a stopped project again.
    const retryStopped = trigger === "reparse" && !isQueueRunning();
    const autoAddedKeys = reconcileAutoTrackedQueue(
        desiredItems,
        reconciliationComplete,
        retryStopped
    );
    for (const plan of plans) {
        if (plan.row !== null && autoAddedKeys.has(queueItemKey(plan.row))) {
            newlyQueuedChanged += plan.changed;
        }
    }
    autoRunRefresh(trigger, changed, newlyQueuedChanged, detectedWorkKeys);
}

onImportableCacheWarm(autoTrackRefresh);

// Switching auto-run on owes every armed project a full scan, which needs a
// project row queued even when no file changed.
setOnArmingScansReset(() => autoTrackRefresh("cacheWarm"));
