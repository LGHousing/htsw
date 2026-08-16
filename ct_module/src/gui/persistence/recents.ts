/// <reference types="../../../CTAutocomplete" />

import { pathExists } from "../lib/java";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { defineRootDoc } from "../../persistence/store";

const MAX_RECENTS = 8;
const PRUNE_THROTTLE_MS = 1000;

let lastPruneAt = 0;

const store = defineRootDoc<string[]>({
    file: "recents.json",
    legacyPaths: ["./config/ChatTriggers/modules/HTSW/gui-recents.json"],
    onReadError: "defaults",
    pretty: true,
    fallback: [],
    // Normalize + dedupe on read: older versions stored whatever spelling the
    // caller had (absolute vs ./htsw/...), so one file could sit in the list
    // twice.
    parse: (raw, fallback) => {
        if (!Array.isArray(raw)) return fallback;
        const out: string[] = [];
        for (let i = 0; i < raw.length; i++) {
            const entry: unknown = raw[i];
            if (typeof entry !== "string") continue;
            const norm = normalizeHtswPath(entry);
            if (out.indexOf(norm) === -1) out.push(norm);
        }
        return out;
    },
});

// A recent whose file is gone does nothing when clicked, so drop it from the
// list. Throttled: getRecents runs every frame a picker is open.
function pruneMissing(recents: string[]): string[] {
    const now = Date.now();
    if (now - lastPruneAt < PRUNE_THROTTLE_MS) return recents;
    lastPruneAt = now;
    const kept = recents.filter((p) => pathExists(p));
    if (kept.length === recents.length) return recents;
    store.set(kept);
    return kept;
}

export function getRecents(): string[] {
    return pruneMissing(store.get());
}

export function addRecent(path: string): void {
    const norm = normalizeHtswPath(path);
    const recents = store.get();
    const next: string[] = [norm];
    for (let i = 0; i < recents.length; i++) {
        if (recents[i] !== norm) next.push(recents[i]);
        if (next.length >= MAX_RECENTS) break;
    }
    store.set(next);
}
