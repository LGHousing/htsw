import type { Importable } from "htsw/types";

import {
    houseTypeScanned,
    loadImportableCachesOffThread,
    type ImportableCacheLoadRequest,
} from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { recordRuntimeDebug } from "../../runtimeDebug/runtimeDebugBuffer";
import { markGuiDirty } from "../lib/dirty";

// A batch that has not reported back after this long is written off: its
// requests are re-queued and a later completion from it is ignored. The
// loader itself guarantees completion on every error path, so this only
// covers a worker thread that never returns at all (a hang, not a throw).
const BATCH_STALL_MS = 20_000;

const pending: ImportableCacheLoadRequest[] = [];
const requested = new Set<string>();
const listeners: Array<() => void> = [];
let loading = false;
let loadingSince = 0;
let batchGeneration = 0;
let revision = 0;

function requestKey(request: ImportableCacheLoadRequest): string {
    return `${request.housingUuid}|${request.type}|${request.identity}`;
}

export function requestImportableCacheWarm(
    housingUuid: string,
    importable: Importable
): void {
    const request = {
        housingUuid,
        type: importable.type,
        identity: importableIdentity(importable),
    };
    const key = requestKey(request);
    if (requested.has(key)) return;
    requested.add(key);
    pending.push(request);
}

export function processImportableCacheWarm(): void {
    if (loading && Date.now() - loadingSince > BATCH_STALL_MS) {
        recordRuntimeDebug("cacheWarmBatchStalled", {
            generation: batchGeneration,
            waitedMs: Date.now() - loadingSince,
        });
        batchGeneration++;
        loading = false;
        // Rows re-request what they still need on their next render.
        requested.clear();
    }
    if (loading || pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    const generation = ++batchGeneration;
    loading = true;
    loadingSince = Date.now();
    loadImportableCachesOffThread(batch, () => {
        if (generation !== batchGeneration) return;
        const scanned = new Set<string>();
        for (let i = 0; i < batch.length; i++) {
            const request = batch[i];
            requested.delete(requestKey(request));
            const scanKey = `${request.housingUuid}|${request.type}`;
            if (scanned.has(scanKey)) continue;
            scanned.add(scanKey);
            houseTypeScanned(request.housingUuid, request.type);
        }
        loading = false;
        revision++;
        markGuiDirty();
        for (let i = 0; i < listeners.length; i++) listeners[i]();
    });
}

export function getImportableCacheWarmRevision(): number {
    return revision;
}

export function onImportableCacheWarm(listener: () => void): () => void {
    listeners.push(listener);
    return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
    };
}
