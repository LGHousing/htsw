import type { Importable } from "htsw/types";

import {
    houseTypeScanned,
    loadImportableCachesOffThread,
    type ImportableCacheLoadRequest,
} from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { markGuiDirty } from "../lib/dirty";

const pending: ImportableCacheLoadRequest[] = [];
const requested = new Set<string>();
const listeners: Array<() => void> = [];
let loading = false;
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
    if (loading || pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    loading = true;
    loadImportableCachesOffThread(batch, () => {
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
