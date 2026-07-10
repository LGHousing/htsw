/// <reference types="../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import {
    getAutoTrackSources,
    isAnyAutoTrackEnabled,
    getHousingUuid,
    importableSelectionKey,
    isImportableChecked,
    toggleImportableChecked,
} from "./state";
import {
    canonicalPath,
    forEachCachedParse,
    parseImportJsonBlocking,
} from "./parsing/parses";
import { importableIdentity } from "../importables/identity";
import { statusForImportable } from "./cache-status";
import { addToQueue, makeImportableQueueItem } from "./right-panel/import-tab/queue";

export function queueModifiedImportables(
    sourcePath: string,
    importables: readonly Importable[]
): void {
    const canonicalSourcePath = canonicalPath(sourcePath);
    for (const imp of importables) {
        const status = statusForImportable(imp);
        if (status === "modified" || status === "unknown") {
            const item = makeImportableQueueItem(imp, canonicalSourcePath);
            addToQueue(item);
            const key = importableSelectionKey(
                canonicalSourcePath,
                imp.type,
                importableIdentity(imp)
            );
            if (!isImportableChecked(key)) toggleImportableChecked(key);
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
