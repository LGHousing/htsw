/// <reference types="../../CTAutocomplete" />

import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../persistence/settingsFiles";

/**
 * Plain-English nicknames for Housing UUIDs. The UUID is the canonical
 * identity (cache directories, knowledge entries) but it's a 36-char
 * string that's painful to read in the GUI; the alias is what the user
 * actually sees.
 *
 * Storage: a single JSON file under the settings root. Writes are
 * full-rewrites that preserve every other UUID's alias.
 *
 * Reads serve an in-memory copy: alias lookups happen per row per FRAME
 * (Importables bound-house chips, Houses headers), and a FileLib.read per
 * lookup was hundreds of disk reads a second — visible as input jitter
 * while the overlay was open. Writes refresh the copy; a short TTL
 * re-read picks up out-of-band edits to the file.
 */

const ALIAS_FILE_NAME = "housing-aliases.json";

type AliasMap = Partial<Record<string, string>>;

let cachedMap: AliasMap | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 2000;

function rememberMap(map: AliasMap): AliasMap {
    cachedMap = map;
    cachedAt = Date.now();
    return map;
}

function readMap(): AliasMap {
    const now = Date.now();
    if (now - cachedAt < CACHE_TTL_MS) return cachedMap ?? {};
    const map = readMapFromDisk();
    if (map !== null) return rememberMap(map);
    cachedAt = now;
    return cachedMap ?? {};
}

function readMapFromDisk(): AliasMap | null {
    const stored = readJsonSettingsFile(ALIAS_FILE_NAME);
    if (!stored.ok) return null;
    if (!stored.found) return {};
    const parsed = stored.value;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const out: AliasMap = {};
    const obj = parsed as { [k: string]: unknown };
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value !== "string" || value.length === 0) return null;
            out[key] = value;
        }
    }
    return out;
}

function writeMap(map: AliasMap): boolean {
    if (!writeJsonSettingsFile(ALIAS_FILE_NAME, map, true)) return false;
    rememberMap(map);
    return true;
}

export function getAlias(uuid: string): string | null {
    const map = readMap();
    const v = map[uuid];
    return typeof v === "string" && v.length > 0 ? v : null;
}

export function setAlias(uuid: string, alias: string): boolean {
    const trimmed = alias.trim();
    const map = readMapFromDisk();
    if (map === null) return false;
    const previous = map[uuid];
    if ((trimmed.length === 0 && previous === undefined) || previous === trimmed) {
        rememberMap(map);
        return true;
    }
    if (trimmed.length === 0) {
        delete map[uuid];
    } else {
        map[uuid] = trimmed;
    }
    return writeMap(map);
}

export function clearAlias(uuid: string): boolean {
    const map = readMapFromDisk();
    if (map === null) return false;
    if (!Object.prototype.hasOwnProperty.call(map, uuid)) {
        rememberMap(map);
        return true;
    }
    delete map[uuid];
    return writeMap(map);
}

export function listAliases(): AliasMap {
    return readMap();
}

/** What the GUI shows for a house: its alias, else a shortened uuid. */
export function houseDisplayName(uuid: string): string {
    const alias = getAlias(uuid);
    if (alias !== null) return alias;
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}
