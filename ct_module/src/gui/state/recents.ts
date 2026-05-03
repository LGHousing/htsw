/// <reference types="../../../CTAutocomplete" />

const RECENTS_PATH = "./config/ChatTriggers/modules/HTSW/gui-recents.json";
const MAX_RECENTS = 8;

let recents: string[] = [];
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(RECENTS_PATH)) return;
        const raw = String(FileLib.read(RECENTS_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const filtered: string[] = [];
            for (let i = 0; i < parsed.length; i++) {
                if (typeof parsed[i] === "string") filtered.push(parsed[i]);
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

export function getRecents(): string[] {
    load();
    return recents;
}

export function addRecent(path: string): void {
    load();
    const norm = path.replace(/\\/g, "/");
    const next: string[] = [norm];
    for (let i = 0; i < recents.length; i++) {
        if (recents[i] !== norm) next.push(recents[i]);
        if (next.length >= MAX_RECENTS) break;
    }
    recents = next;
    persist();
}

export function clearRecents(): void {
    recents = [];
    persist();
}
