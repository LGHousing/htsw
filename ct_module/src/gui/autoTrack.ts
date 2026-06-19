/// <reference types="../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import {
    getAutoTrackSources,
    isAnyAutoTrackEnabled,
    getHousingUuid,
    isImportableChecked,
    toggleImportableChecked,
} from "./state";
import {
    canonicalPath,
    forEachCachedParse,
    markParseStale,
    parseImportJsonBlocking,
} from "./parsing/parses";
import { importableIdentity, importableKey } from "../importCache/paths";
import { statusForImportable } from "./cache-status";
import { addToQueue, makeImportableQueueItem } from "./right-panel/import-tab/queue";

export function queueModifiedFromParse(
    sourcePath: string,
    importables: readonly Importable[]
): void {
    const canonicalSourcePath = canonicalPath(sourcePath);
    for (const imp of importables) {
        const status = statusForImportable(imp);
        if (status === "modified" || status === "unknown") {
            const item = makeImportableQueueItem(imp, canonicalSourcePath);
            addToQueue(item);
            const key = importableKey(imp.type, importableIdentity(imp));
            if (!isImportableChecked(key)) toggleImportableChecked(key);
        }
    }
}

export function queueModifiedFromPath(sourcePath: string): void {
    markParseStale(sourcePath);
    const cached = parseImportJsonBlocking(sourcePath);
    if (cached.parsed === null) {
        ChatLib.chat(`&c[htsw] Skipping ${sourcePath}: ${cached.error ?? "parse failed"}`);
        return;
    }
    queueModifiedFromParse(cached.canonicalPath, cached.parsed.value);
}

export function autoTrackRefresh(): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getAutoTrackSources();
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        if (!tracked.has(entry.canonicalPath)) return;
        queueModifiedFromParse(entry.canonicalPath, entry.parsed.value);
    });
}
