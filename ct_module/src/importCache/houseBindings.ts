/// <reference types="../../CTAutocomplete" />

import { IMPORT_CACHE_ROOT } from "./paths";

/**
 * Reverse index from Housing UUID to the import.json bound to it via the
 * file's top-level "houseUuid" key. The key inside the file is the
 * authoritative binding; this index only exists so the GUI can answer
 * "which file belongs to house X" without parsing every known file. It is
 * rebuilt opportunistically — every parse re-records (or clears) the entry
 * for the parsed file — so a stale path heals on the next parse.
 *
 * Storage mirrors housing-aliases.json: one small JSON file, on-demand
 * reads, full-rewrite writes.
 */

const BINDINGS_FILE = `${IMPORT_CACHE_ROOT}/housing-bindings.json`;

type BindingMap = { [uuid: string]: string };

function readMap(): BindingMap {
    try {
        if (!FileLib.exists(BINDINGS_FILE)) return {};
        const raw = String(FileLib.read(BINDINGS_FILE) ?? "");
        if (raw.trim() === "") return {};
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== "object") return {};
        const out: BindingMap = {};
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

function writeMap(map: BindingMap): void {
    try {
        FileLib.write(BINDINGS_FILE, JSON.stringify(map, null, 2), true);
    } catch (_e) {
        // best-effort — the index is rebuilt from parses anyway
    }
}

/** Canonical path of the import.json bound to `uuid`, or null. May be stale
 *  until that file is next parsed; callers should treat it as a hint. */
export function boundImportJsonPath(uuid: string): string | null {
    const v = readMap()[uuid];
    return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Record what a completed parse of `canonicalPath` declared: its houseUuid
 * (or null when unbound). Clears entries the parse contradicts — the same
 * file bound to a different uuid, or a now-unbound file.
 */
export function recordHouseBinding(houseUuid: string | null, canonicalPath: string): void {
    const map = readMap();
    let changed = false;
    for (const uuid in map) {
        if (map[uuid] === canonicalPath && uuid !== houseUuid) {
            delete map[uuid];
            changed = true;
        }
    }
    if (houseUuid !== null && map[houseUuid] !== canonicalPath) {
        map[houseUuid] = canonicalPath;
        changed = true;
    }
    if (changed) writeMap(map);
}
