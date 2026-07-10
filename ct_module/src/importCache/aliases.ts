/// <reference types="../../CTAutocomplete" />

import { IMPORT_CACHE_ROOT } from "./paths";
import { atomicWriteText } from "../utils/filesystem";

/**
 * Plain-English nicknames for Housing UUIDs. The UUID is the canonical
 * identity (cache directories, knowledge entries) but it's a 36-char
 * string that's painful to read in the GUI; the alias is what the user
 * actually sees.
 *
 * Storage: a single JSON file under the import cache root. Writes are
 * full-rewrites that preserve every other UUID's alias.
 *
 * Reads serve an in-memory copy: alias lookups happen per row per FRAME
 * (Importables bound-house chips, Houses headers), and a FileLib.read per
 * lookup was hundreds of disk reads a second — visible as input jitter
 * while the overlay was open. Writes refresh the copy; a short TTL
 * re-read picks up out-of-band edits to the file.
 */

const ALIAS_FILE = `${IMPORT_CACHE_ROOT}/housing-aliases.json`;

type AliasMap = { [uuid: string]: string };

let cachedMap: AliasMap | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 2000;

function readMap(): AliasMap {
    const now = Date.now();
    if (cachedMap !== null && now - cachedAt < CACHE_TTL_MS) return cachedMap;
    const map = readMapFromDisk();
    cachedMap = map;
    cachedAt = now;
    return map;
}

function readMapFromDisk(): AliasMap {
    try {
        if (!FileLib.exists(ALIAS_FILE)) return {};
        const raw = String(FileLib.read(ALIAS_FILE) ?? "");
        if (raw.trim() === "") return {};
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== "object") return {};
        const out: AliasMap = {};
        const obj = parsed as { [k: string]: unknown };
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = obj[key];
                if (typeof value === "string" && value.length > 0) {
                    out[key] = value;
                }
            }
        }
        return out;
    } catch (_e) {
        return {};
    }
}

function writeMap(map: AliasMap): void {
    cachedMap = map;
    cachedAt = Date.now();
    atomicWriteText(ALIAS_FILE, JSON.stringify(map, null, 2));
}

export function getAlias(uuid: string): string | null {
    const map = readMap();
    const v = map[uuid];
    return typeof v === "string" && v.length > 0 ? v : null;
}

export function setAlias(uuid: string, alias: string): void {
    const trimmed = alias.trim();
    const map = readMap();
    if (trimmed.length === 0) {
        delete map[uuid];
    } else {
        map[uuid] = trimmed;
    }
    writeMap(map);
}

export function clearAlias(uuid: string): void {
    const map = readMap();
    if (!Object.prototype.hasOwnProperty.call(map, uuid)) return;
    delete map[uuid];
    writeMap(map);
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
