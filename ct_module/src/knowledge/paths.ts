import type { Importable } from "htsw/types";

export const KNOWLEDGE_ROOT = "./htsw/.cache";

/**
 * Per-importable-type subdirectory under the per-housing cache root.
 * Lowercase, plural-free, matches existing convention (`items/` is already
 * used for the SNBT cache so item knowledge lives next to it under
 * `item/`, intentionally singular for the new tree).
 */
function dirFor(type: Importable["type"]): string {
    switch (type) {
        case "FUNCTION": return "function";
        case "EVENT": return "event";
        case "REGION": return "region";
        case "ITEM": return "item";
        case "MENU": return "menu";
        case "NPC": return "npc";
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
 * Rules:
 *   - lowercase ASCII letters/digits/`-`/`_` pass through verbatim,
 *   - everything else becomes `_<hex>` of the UTF-16 unit (so the encoding
 *     is bijective and collision-resistant).
 */
export function slug(identity: string): string {
    let out = "";
    for (let i = 0; i < identity.length; i++) {
        const ch = identity.charAt(i);
        const code = identity.charCodeAt(i);
        const safe =
            (code >= 0x30 && code <= 0x39) || // 0-9
            (code >= 0x41 && code <= 0x5a) || // A-Z
            (code >= 0x61 && code <= 0x7a) || // a-z
            ch === "-" || ch === "_";
        if (safe) {
            out += ch;
        } else {
            // ES5 lib — no String.prototype.padStart. Manual pad to 4 hex
            // digits so every code point produces a fixed-width escape.
            let hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "_" + hex;
        }
    }
    return out;
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
