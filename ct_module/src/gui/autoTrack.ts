/// <reference types="../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import {
    getAutoTrackSources,
    isAnyAutoTrackEnabled,
    getHousingUuid,
} from "./state";
import {
    canonicalPath,
    forEachCachedParse,
    parseImportJsonBlocking,
} from "./parsing/parses";
import { cachedStatusForImportable } from "./cache-status";
import {
    addToQueue,
    makeImportableQueueItem,
} from "./right-panel/import-tab/queue";
import { onImportableCacheWarm } from "./cache-status/cacheWarm";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { importableIdentity } from "../importables/identity";
import { showToast } from "./toast";

type ModifiedQueueResult = {
    changed: number;
    required: number;
    newlyQueuedRequired: number;
};

export function needsModifiedQueue(imp: Importable): boolean {
    return cachedStatusForImportable(imp) === "modified";
}

export function queueModifiedImportables(
    sourcePath: string,
    parsed: ImportablesParseResult,
    importables: readonly Importable[] = parsed.value
): ModifiedQueueResult {
    const canonicalSourcePath = canonicalPath(sourcePath);
    const modified: Importable[] = [];
    for (const imp of importables) {
        if (needsModifiedQueue(imp)) modified.push(imp);
    }
    const housingUuid = getHousingUuid();
    const expansion =
        housingUuid === null
            ? null
            : expandImportDependencies(parsed, modified, housingUuid);
    const work = expansion?.importables ?? modified;
    const required = expansion?.addedImportables ?? [];
    const requiredKeys = new Set<string>();
    for (const importable of required) {
        requiredKeys.add(`${importable.type}:${importableIdentity(importable)}`);
    }
    let newlyQueuedRequired = 0;
    for (const importable of work) {
        const added = addToQueue(
            makeImportableQueueItem(importable, canonicalSourcePath)
        );
        if (
            added &&
            requiredKeys.has(`${importable.type}:${importableIdentity(importable)}`)
        ) {
            newlyQueuedRequired++;
        }
    }
    return {
        changed: modified.length,
        required: required.length,
        newlyQueuedRequired,
    };
}

export function queueModifiedFromPath(sourcePath: string): void {
    const cached = parseImportJsonBlocking(sourcePath);
    if (cached.parsed === null) {
        ChatLib.chat(`&c[htsw] Skipping ${sourcePath}: ${cached.error ?? "parse failed"}`);
        return;
    }
    queueModifiedImportables(cached.canonicalPath, cached.parsed);
}

export function autoTrackRefresh(): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getAutoTrackSources();
    let changed = 0;
    let required = 0;
    let newlyQueuedRequired = 0;
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        if (!tracked.has(entry.canonicalPath)) return;
        const result = queueModifiedImportables(entry.canonicalPath, entry.parsed);
        changed += result.changed;
        required += result.required;
        newlyQueuedRequired += result.newlyQueuedRequired;
    });
    if (newlyQueuedRequired > 0) {
        showToast(
            `Auto-Track: ${changed} changed + ${required} required = ${changed + required} queued`,
            0xff5c9ded,
            8000
        );
    }
}

onImportableCacheWarm(autoTrackRefresh);
