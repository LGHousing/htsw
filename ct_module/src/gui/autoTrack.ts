/// <reference types="../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { isAnyAutoTrackEnabled, getHousingUuid, isCurrentHouseTrusted } from "./state";
import { getActiveAutoTrackSources } from "./autoTrackScope";
import { canonicalPath, forEachCachedParse } from "./parsing/parses";
import { cachedStatusForImportable, statusForImportableBlocking } from "./cache-status";
import {
    makeImportableQueueRow,
    queueItemKey,
    reconcileAutoTrackedQueue,
    type ImportQueueItem,
} from "./right-panel/import-tab/queue";
import { onImportableCacheWarm } from "./cache-status/cacheWarm";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { importableIdentity } from "../importables/identity";
import { showToast } from "./toast";
import { autoRunRefresh } from "./autoRun";

type ModifiedQueueOptions = {
    blockingCacheRead?: boolean;
};

type PlannedQueueItem = {
    item: ImportQueueItem;
    changed: boolean;
    required: boolean;
    workKey: string;
};

type ModifiedQueuePlan = {
    changed: number;
    required: number;
    complete: boolean;
    items: PlannedQueueItem[];
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

function planModifiedImportables(
    sourcePath: string,
    parsed: ImportablesParseResult,
    importables: readonly Importable[] = parsed.value,
    options: ModifiedQueueOptions = {}
): ModifiedQueuePlan {
    const canonicalSourcePath = canonicalPath(sourcePath);
    const modified: Importable[] = [];
    let complete = true;
    for (const imp of importables) {
        const status = importableStatus(imp, options.blockingCacheRead ?? false);
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
    const required = expansion?.addedImportables ?? [];
    const requiredKeys = new Set<string>();
    for (const importable of required) {
        requiredKeys.add(`${importable.type}:${importableIdentity(importable)}`);
    }
    const modifiedKeys = new Set<string>();
    for (const importable of modified) {
        modifiedKeys.add(`${importable.type}:${importableIdentity(importable)}`);
    }
    const items: PlannedQueueItem[] = [];
    for (const importable of work) {
        const identityKey = `${importable.type}:${importableIdentity(importable)}`;
        const item = makeImportableQueueRow({
            op: "import",
            house: parsed.importJson.houseUuid,
            path: canonicalSourcePath,
            type: importable.type,
            identity: importableIdentity(importable),
            label: importable.type === "EVENT" ? importable.event : importable.name,
            origin: "autotrack",
        }) as ImportQueueItem;
        items.push({
            item,
            changed: modifiedKeys.has(identityKey),
            required: requiredKeys.has(identityKey),
            workKey: item.key,
        });
    }
    return {
        changed: modified.length,
        required: required.length,
        complete,
        items,
    };
}

export type AutoTrackRefreshTrigger = "reparse" | "cacheWarm";

export function autoTrackRefresh(trigger: AutoTrackRefreshTrigger = "cacheWarm"): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getActiveAutoTrackSources();
    let changed = 0;
    let required = 0;
    let newlyQueuedChanged = 0;
    let newlyQueuedRequired = 0;
    const detectedWorkKeys: string[] = [];
    const plans: ModifiedQueuePlan[] = [];
    const seenTracked = new Set<string>();
    let reconciliationComplete = true;
    forEachCachedParse((entry) => {
        if (!tracked.has(entry.canonicalPath)) return;
        seenTracked.add(entry.canonicalPath);
        if (entry.parsed === null) {
            reconciliationComplete = false;
            return;
        }
        const plan = planModifiedImportables(entry.canonicalPath, entry.parsed);
        plans.push(plan);
        if (!plan.complete) reconciliationComplete = false;
        changed += plan.changed;
        required += plan.required;
        for (const planned of plan.items) {
            detectedWorkKeys.push(planned.workKey);
        }
    });
    if (seenTracked.size !== tracked.size) reconciliationComplete = false;

    const desiredItems: ImportQueueItem[] = [];
    for (const plan of plans) {
        for (const planned of plan.items) desiredItems.push(planned.item);
    }
    const autoAddedKeys = reconcileAutoTrackedQueue(desiredItems, reconciliationComplete);
    for (const plan of plans) {
        for (const planned of plan.items) {
            if (!autoAddedKeys.has(queueItemKey(planned.item))) continue;
            if (planned.changed) newlyQueuedChanged++;
            if (planned.required) newlyQueuedRequired++;
        }
    }
    if (newlyQueuedRequired > 0) {
        showToast(
            `Auto-Track: ${changed} changed + ${required} required = ${changed + required} queued`,
            0xff5c9ded,
            8000
        );
    }
    autoRunRefresh(trigger, changed, newlyQueuedChanged, detectedWorkKeys, tracked);
}

onImportableCacheWarm(autoTrackRefresh);
