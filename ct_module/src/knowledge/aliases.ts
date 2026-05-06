/// <reference types="../../CTAutocomplete" />

import { KNOWLEDGE_ROOT } from "./paths";

/**
 * Plain-English nicknames for Housing UUIDs. The UUID is the canonical
 * identity (cache directories, knowledge entries) but it's a 36-char
 * string that's painful to read in the GUI; the alias is what the user
 * actually sees.
 *
 * Storage: a single JSON file under the knowledge cache root. Reads are
 * on-demand (no in-memory cache — the file is small and only consulted
 * when the GUI needs to render a header). Writes are full-rewrites that
 * preserve every other UUID's alias.
 */

const ALIAS_FILE = `${KNOWLEDGE_ROOT}/housing-aliases.json`;

type AliasMap = { [uuid: string]: string };

function readMap(): AliasMap {
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
    try {
        FileLib.write(ALIAS_FILE, JSON.stringify(map, null, 2), true);
    } catch (_e) {
        // best-effort — failure to persist an alias shouldn't crash the GUI
    }
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
