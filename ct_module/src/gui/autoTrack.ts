/// <reference types="../../CTAutocomplete" />

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

export function needsModifiedQueue(imp: Importable): boolean {
    return cachedStatusForImportable(imp) === "modified";
}

export function queueModifiedImportables(
    sourcePath: string,
    importables: readonly Importable[]
): void {
    const canonicalSourcePath = canonicalPath(sourcePath);
    for (const imp of importables) {
        if (needsModifiedQueue(imp)) {
            const item = makeImportableQueueItem(imp, canonicalSourcePath);
            addToQueue(item);
        }
    }
}

export function queueModifiedFromPath(sourcePath: string): void {
    const cached = parseImportJsonBlocking(sourcePath);
    if (cached.parsed === null) {
        ChatLib.chat(`&c[htsw] Skipping ${sourcePath}: ${cached.error ?? "parse failed"}`);
        return;
    }
    queueModifiedImportables(cached.canonicalPath, cached.parsed.value);
}

export function autoTrackRefresh(): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getAutoTrackSources();
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        if (!tracked.has(entry.canonicalPath)) return;
        queueModifiedImportables(entry.canonicalPath, entry.parsed.value);
    });
}

onImportableCacheWarm(autoTrackRefresh);
