import type { Importable } from "htsw/types";

import type { ObservedNode } from "../../../housingSync/observedActions";
import { normalizeHtswPath } from "../../lib/pathDisplay";
import {
    beginPreviewRead,
    hasPreviewState,
    primeWithCache,
    setObservedTopLevel,
} from "./livePreview";

export type ImportPreviewReplay = {
    start(key: string, path: string | null, cached: Importable | null): void;
    beginRead(key: string, path: string): void;
    observe(key: string, nodes: readonly ObservedNode[]): void;
    restore(key: string, path: string | null): void;
};

export function createImportPreviewReplay(trustMode: boolean): ImportPreviewReplay {
    const cachedByKey = new Map<string, Importable | null>();
    const latestObservedByKey = new Map<string, readonly ObservedNode[]>();
    const ownerByPath = new Map<string, string>();

    return {
        start(key, path, cached) {
            cachedByKey.set(key, cached);
            latestObservedByKey.delete(key);
            if (path !== null) ownerByPath.set(normalizeHtswPath(path), key);
        },
        beginRead(key, path) {
            latestObservedByKey.delete(key);
            beginPreviewRead(path);
        },
        observe(key, nodes) {
            latestObservedByKey.set(key, nodes);
        },
        restore(key, path) {
            if (path === null) return;
            const normalizedPath = normalizeHtswPath(path);
            if (ownerByPath.get(normalizedPath) === key && hasPreviewState(path)) return;
            const observed = latestObservedByKey.get(key);
            if (observed !== undefined) {
                setObservedTopLevel(path, observed, { force: true });
            } else {
                primeWithCache(path, cachedByKey.get(key) ?? null, {
                    shellOnly: !trustMode,
                });
            }
            ownerByPath.set(normalizedPath, key);
        },
    };
}
