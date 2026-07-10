/// <reference types="../../../CTAutocomplete" />

import { pathExists } from "../lib/java";
import { normalizeHtswPath } from "../lib/pathDisplay";

const RECENTS_PATH = "./config/ChatTriggers/modules/HTSW/gui-recents.json";
const MAX_RECENTS = 8;
const PRUNE_THROTTLE_MS = 1000;

let recents: string[] = [];
let loaded = false;
let lastPruneAt = 0;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(RECENTS_PATH)) return;
        const raw = String(FileLib.read(RECENTS_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            // Normalize + dedupe: older versions stored whatever spelling the
            // caller had (absolute vs ./htsw/...), so one file could sit in
            // the list twice.
            const filtered: string[] = [];
            for (let i = 0; i < parsed.length; i++) {
                if (typeof parsed[i] !== "string") continue;
                const norm = normalizeHtswPath(parsed[i]);
                if (filtered.indexOf(norm) === -1) filtered.push(norm);
            }
            recents = filtered;
        }
    } catch (_e) {
        recents = [];
    }
}

function persist(): void {
    try {
        FileLib.write(RECENTS_PATH, JSON.stringify(recents, null, 2), true);
    } catch (_e) {
        // ignore
    }
}

// A recent whose file is gone does nothing when clicked, so drop it from the
// list. Throttled: getRecents runs every frame a picker is open.
function pruneMissing(): void {
    const now = Date.now();
    if (now - lastPruneAt < PRUNE_THROTTLE_MS) return;
    lastPruneAt = now;
    const kept = recents.filter((p) => pathExists(p));
    if (kept.length === recents.length) return;
    recents = kept;
    persist();
}

export function getRecents(): string[] {
    load();
    pruneMissing();
    return recents;
}

export function addRecent(path: string): void {
    load();
    const norm = normalizeHtswPath(path);
    const next: string[] = [norm];
    for (let i = 0; i < recents.length; i++) {
        if (recents[i] !== norm) next.push(recents[i]);
        if (next.length >= MAX_RECENTS) break;
    }
    recents = next;
    persist();
}