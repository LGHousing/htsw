/// <reference types="../../CTAutocomplete" />

import {
    asStringMapValue,
    defineRootDoc,
    serializeStringMap,
} from "../persistence/store";

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
 * while the overlay was open. The store's TTL re-read picks up out-of-band
 * edits to the file without paying that cost.
 */

const CACHE_TTL_MS = 2000;

const aliases = defineRootDoc<Map<string, string>>({
    file: "housing-aliases.json",
    ttlMs: CACHE_TTL_MS,
    pretty: true,
    fallback: new Map<string, string>(),
    parse: (raw, fallback) => {
        const parsed = asStringMapValue(raw, fallback);
        if (parsed === fallback) return fallback;
        // An empty alias is not a name; the writer never stores one, but a
        // hand-edited file can.
        const out = new Map<string, string>();
        parsed.forEach((value, key) => {
            if (value.length > 0) out.set(key, value);
        });
        return out;
    },
    serialize: serializeStringMap,
});

let revision = 0;

/**
 * Bumped whenever a stored alias changes. GUI trees that bake a house's
 * display name into a cached row have no other way to notice the rename.
 */
export function getAliasRevision(): number {
    return revision;
}

function writeAliases(next: Map<string, string>): boolean {
    if (!aliases.set(next)) return false;
    revision++;
    return true;
}

export function getAlias(uuid: string): string | null {
    return aliases.get().get(uuid) ?? null;
}

export function setAlias(uuid: string, alias: string): boolean {
    const trimmed = alias.trim();
    const current = aliases.get();
    if ((current.get(uuid) ?? "") === trimmed) return true;
    const next = new Map<string, string>(current);
    if (trimmed.length === 0) next.delete(uuid);
    else next.set(uuid, trimmed);
    return writeAliases(next);
}

export function clearAlias(uuid: string): boolean {
    const current = aliases.get();
    if (!current.has(uuid)) return true;
    const next = new Map<string, string>(current);
    next.delete(uuid);
    return writeAliases(next);
}

export function listAliases(): Partial<Record<string, string>> {
    const out: Partial<Record<string, string>> = {};
    aliases.get().forEach((value, key) => {
        out[key] = value;
    });
    return out;
}

/** What the GUI shows for a house: its alias, else a shortened uuid. */
export function houseDisplayName(uuid: string): string {
    const alias = getAlias(uuid);
    if (alias !== null) return alias;
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}
