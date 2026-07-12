/// <reference types="../../../CTAutocomplete" />

import { canonicalPath } from "../parsing/parses";

const AUTO_TRACK_FILE = "./htsw/.cache/auto-track.json";
let autoTrackSourcesLoaded = false;
const autoTrackSources: Set<string> = new Set();

function loadAutoTrackSources(): void {
    if (autoTrackSourcesLoaded) return;
    try {
        if (FileLib.exists(AUTO_TRACK_FILE)) {
            const raw = String(FileLib.read(AUTO_TRACK_FILE) ?? "");
            if (raw.trim() !== "") {
                const parsed = JSON.parse(raw) as unknown;
                if (Array.isArray(parsed)) {
                    for (let i = 0; i < parsed.length; i++) {
                        if (typeof parsed[i] === "string") {
                            autoTrackSources.add(canonicalPath(parsed[i]));
                        }
                    }
                }
            }
        }
        autoTrackSourcesLoaded = true;
    } catch (_e) {}
}

function saveAutoTrackSources(): void {
    try {
        const sources: string[] = [];
        autoTrackSources.forEach((source) => sources.push(source));
        sources.sort();
        FileLib.write(AUTO_TRACK_FILE, JSON.stringify(sources), true);
    } catch (_e) {}
}

export function isAutoTrackSource(sourcePath: string): boolean {
    loadAutoTrackSources();
    return autoTrackSources.has(canonicalPath(sourcePath));
}
export function toggleAutoTrackSource(sourcePath: string): boolean {
    loadAutoTrackSources();
    const canon = canonicalPath(sourcePath);
    if (autoTrackSources.has(canon)) {
        autoTrackSources.delete(canon);
        saveAutoTrackSources();
        return false;
    }
    autoTrackSources.add(canon);
    saveAutoTrackSources();
    return true;
}
export function isAnyAutoTrackEnabled(): boolean {
    loadAutoTrackSources();
    return autoTrackSources.size > 0;
}
export function getAutoTrackSources(): ReadonlySet<string> {
    loadAutoTrackSources();
    return autoTrackSources;
}
