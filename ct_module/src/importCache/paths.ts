import type { Importable } from "htsw/types";
import { encodeFilesystemComponent } from "../utils/filesystem";
import { importableIdentity } from "../importables/identity";

export const IMPORT_CACHE_ROOT = "./htsw/.cache";

/**
 * Per-importable-type subdirectory under the per-housing cache root.
 * Lowercase, plural-free, matches existing convention (`items/` is already
 * used for the SNBT cache so item importable-cache entries live next to it under
 * `item/`, intentionally singular for the new tree).
 */
function dirFor(type: Importable["type"]): string {
    switch (type) {
        case "FUNCTION":
            return "function";
        case "EVENT":
            return "event";
        case "REGION":
            return "region";
        case "ITEM":
            return "item";
        case "MENU":
            return "menu";
        case "NPC":
            return "npc";
        case "TEAM":
            return "team";
        case "GROUP":
            return "group";
        case "COMMAND":
            return "command";
        case "HOUSE_NAME":
            return "house-name";
        default: {
            const _exhaustive: never = type;
            return _exhaustive;
        }
    }
}

/**
 * Encode an identity into something filesystem-safe. Hypixel allows
 * characters in function/region names that some filesystems do not (e.g.
 * `:` on Windows), so we normalize them rather than gambling on the host.
 *
 * Cache filenames escape dots too, reserving `.` for `.knowledge.json` and
 * avoiding odd path segment edge cases. Export filenames use the same encoder
 * with dots preserved for readability.
 */
function slug(identity: string): string {
    return encodeFilesystemComponent(identity, { escapeDots: true });
}

/** Full path to the cache JSON file for a (housing, importable) pair. */
export function cachePathFor(housingUuid: string, importable: Importable): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/${dirFor(importable.type)}/${slug(importableIdentity(importable))}.knowledge.json`;
}

/** The per-(housing, type) directory holding that type's `.knowledge.json`
 *  files. Used to enumerate every importable of a type in a house. */
export function cacheTypeDir(housingUuid: string, type: Importable["type"]): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/${dirFor(type)}`;
}

export function cacheScanMarkerPath(
    housingUuid: string,
    type: Importable["type"]
): string {
    return `${cacheTypeDir(housingUuid, type)}/.scan-complete`;
}

/** Path used by callers that only know the type + identity (e.g. delete). */
export function cachePathForId(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/${dirFor(type)}/${slug(identity)}.knowledge.json`;
}

/**
 * Per-housing SNBT cache for items with click actions. Distinct from the
 * `item/` importable-cache dir (which holds the .knowledge.json metadata) — this
 * stores the raw NBT we captured after editing so a later reference can
 * inject the same item without redoing the edits.
 */
export function itemSnbtCachePath(housingUuid: string, hash: string): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/items/${hash}.snbt`;
}

/**
 * Per-housing cache of an item's `interact_data` (the housing-scoped encoding of
 * its click actions), keyed by the HASH OF THE ACTIONS, not the item. Two items
 * with identical click actions share one blob — and we splice it onto a source
 * cosmetic item rather than caching a whole NBT snapshot.
 */
export function interactDataCachePath(housingUuid: string, actionsHash: string): string {
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/interact_data/${actionsHash}.snbt`;
}
