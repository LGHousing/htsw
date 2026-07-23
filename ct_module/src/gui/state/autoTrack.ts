/// <reference types="../../../CTAutocomplete" />

import { canonicalPath } from "../parsing/parses";
import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../../persistence/settingsFiles";

const AUTO_TRACK_FILE_NAME = "auto-track.json";
let autoTrackSourcesLoaded = false;
const autoTrackSources: Set<string> = new Set();
let autoTrackRevision = 0;

export function getAutoTrackRevision(): number {
    return autoTrackRevision;
}

function loadAutoTrackSources(): boolean {
    if (autoTrackSourcesLoaded) return true;
    const stored = readJsonSettingsFile(AUTO_TRACK_FILE_NAME);
    if (!stored.ok) return false;
    if (stored.found && !Array.isArray(stored.value)) return false;

    const values: unknown[] = stored.found ? stored.value as unknown[] : [];
    for (let i = 0; i < values.length; i++) {
        if (typeof values[i] !== "string") return false;
    }
    autoTrackSources.clear();
    for (let i = 0; i < values.length; i++) {
        autoTrackSources.add(canonicalPath(values[i] as string));
    }
    autoTrackSourcesLoaded = true;
    return true;
}

function saveAutoTrackSources(): boolean {
    const sources: string[] = [];
    autoTrackSources.forEach((source) => sources.push(source));
    sources.sort();
    return writeJsonSettingsFile(AUTO_TRACK_FILE_NAME, sources);
}

export function isAutoTrackSource(sourcePath: string): boolean {
    loadAutoTrackSources();
    return autoTrackSources.has(canonicalPath(sourcePath));
}
export function toggleAutoTrackSource(sourcePath: string): boolean | null {
    if (!loadAutoTrackSources()) return null;
    const canon = canonicalPath(sourcePath);
    if (autoTrackSources.has(canon)) {
        autoTrackSources.delete(canon);
        if (!saveAutoTrackSources()) {
            autoTrackSources.add(canon);
            return null;
        }
        autoTrackRevision++;
        return false;
    }
    autoTrackSources.add(canon);
    if (!saveAutoTrackSources()) {
        autoTrackSources.delete(canon);
        return null;
    }
    autoTrackRevision++;
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
