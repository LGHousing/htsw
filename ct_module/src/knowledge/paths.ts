import type { Importable } from "htsw/types";
import { encodeFilesystemComponent } from "../utils/filesystem";

export const KNOWLEDGE_ROOT = "./htsw/.cache";

/**
 * Per-importable-type subdirectory under the per-housing cache root.
 * Lowercase, plural-free, matches existing convention (`items/` is already
 * used for the SNBT cache so item knowledge lives next to it under
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
    }
}

/**
 * Stable identifying string for an importable, used as the cache filename.
 * For most importable types this is just the human-given name; events use
 * the event constant since they are singletons.
 */
export function importableIdentity(importable: Importable): string {
    if (importable.type === "EVENT") return importable.event;
    return importable.name;
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
export function slug(identity: string): string {
    return encodeFilesystemComponent(identity, { escapeDots: true });
}

/** Full path to the knowledge JSON file for a (housing, importable) pair. */
export function cachePathFor(housingUuid: string, importable: Importable): string {
    return `${KNOWLEDGE_ROOT}/${housingUuid}/${dirFor(importable.type)}/${slug(importableIdentity(importable))}.knowledge.json`;
}

/** Path used by callers that only know the type + identity (e.g. delete). */
export function cachePathForId(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): string {
    return `${KNOWLEDGE_ROOT}/${housingUuid}/${dirFor(type)}/${slug(identity)}.knowledge.json`;
}

/**
 * Per-housing SNBT cache for items with click actions. Distinct from the
 * `item/` knowledge dir (which holds the .knowledge.json metadata) — this
 * stores the raw NBT we captured after editing so a later reference can
 * inject the same item without redoing the edits.
 */
export function itemSnbtCachePath(housingUuid: string, hash: string): string {
    return `${KNOWLEDGE_ROOT}/${housingUuid}/items/${hash}.snbt`;
}
