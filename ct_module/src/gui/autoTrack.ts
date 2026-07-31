/// <reference types="../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import {
    isAnyAutoTrackEnabled,
    getHousingUuid,
    isCurrentHouseTrusted,
} from "./state";
import { getActiveAutoTrackSources } from "./autoTrackScope";
import {
    canonicalPath,
    forEachCachedParse,
    parseImportJsonBlocking,
} from "./parsing/parses";
import {
    cachedStatusForImportable,
    statusForImportableBlocking,
} from "./cache-status";
import {
    addToQueue,
    makeImportableQueueItem,
} from "./right-panel/import-tab/queue";
import { onImportableCacheWarm } from "./cache-status/cacheWarm";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { importableIdentity } from "../importables/identity";
import { showToast } from "./toast";
import { watchModeRefresh } from "./watchMode";

type ModifiedQueueResult = {
    changed: number;
    required: number;
    newlyQueuedChanged: number;
    newlyQueuedRequired: number;
    workKeys: string[];
};

type ModifiedQueueOptions = {
    blockingCacheRead?: boolean;
};

export function needsModifiedQueue(
    imp: Importable,
    blockingCacheRead = false
): boolean {
    // "unknown" means no cache entry exists — a never-imported importable.
    // New importables must queue too, or auto-track never picks up newly
    // created functions/menus. (A cache that merely isn't loaded yet
    // returns null, not "unknown", and re-queues via the cache-warm event.)
    const status = blockingCacheRead
        ? statusForImportableBlocking(imp)
        : cachedStatusForImportable(imp);
    return status === "modified" || status === "unknown";
}

export function queueModifiedImportables(
    sourcePath: string,
    parsed: ImportablesParseResult,
    importables: readonly Importable[] = parsed.value,
    options: ModifiedQueueOptions = {}
): ModifiedQueueResult {
    const canonicalSourcePath = canonicalPath(sourcePath);
    const modified: Importable[] = [];
    for (const imp of importables) {
        if (needsModifiedQueue(imp, options.blockingCacheRead)) {
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
    let newlyQueuedRequired = 0;
    let newlyQueuedChanged = 0;
    const modifiedKeys = new Set<string>();
    for (const importable of modified) {
        modifiedKeys.add(`${importable.type}:${importableIdentity(importable)}`);
    }
    const workKeys: string[] = [];
    for (const importable of work) {
        const identityKey = `${importable.type}:${importableIdentity(importable)}`;
        workKeys.push(`${canonicalSourcePath}|${identityKey}`);
        const added = addToQueue(
            makeImportableQueueItem(importable, canonicalSourcePath)
        );
        if (added && modifiedKeys.has(identityKey)) newlyQueuedChanged++;
        if (
            added &&
            requiredKeys.has(identityKey)
        ) {
            newlyQueuedRequired++;
        }
    }
    return {
        changed: modified.length,
        required: required.length,
        newlyQueuedChanged,
        newlyQueuedRequired,
        workKeys,
    };
}

export function queueModifiedFromPath(sourcePath: string): void {
    const cached = parseImportJsonBlocking(sourcePath);
    if (cached.parsed === null) {
        ChatLib.chat(`&c[htsw] Skipping ${sourcePath}: ${cached.error ?? "parse failed"}`);
        return;
    }
    queueModifiedImportables(cached.canonicalPath, cached.parsed, undefined, {
        blockingCacheRead: true,
    });
}

export type AutoTrackRefreshTrigger = "reparse" | "cacheWarm";

export function autoTrackRefresh(
    trigger: AutoTrackRefreshTrigger = "cacheWarm"
): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getActiveAutoTrackSources();
    let changed = 0;
    let required = 0;
    let newlyQueuedChanged = 0;
    let newlyQueuedRequired = 0;
    const detectedWorkKeys: string[] = [];
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        if (!tracked.has(entry.canonicalPath)) return;
        const result = queueModifiedImportables(entry.canonicalPath, entry.parsed);
        changed += result.changed;
        required += result.required;
        newlyQueuedChanged += result.newlyQueuedChanged;
        newlyQueuedRequired += result.newlyQueuedRequired;
        for (const key of result.workKeys) detectedWorkKeys.push(key);
    });
    if (newlyQueuedRequired > 0) {
        showToast(
            `Auto-Track: ${changed} changed + ${required} required = ${changed + required} queued`,
            0xff5c9ded,
            8000
        );
    }
    watchModeRefresh(
        trigger,
        changed,
        newlyQueuedChanged,
        detectedWorkKeys,
        tracked
    );
}

onImportableCacheWarm(autoTrackRefresh);
