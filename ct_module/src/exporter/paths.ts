import type { Importable } from "htsw/types";

/**
 * Filesystem-safe encoding for an importable's identity, used to derive
 * `.htsl` filenames during export.
 *
 * Mirrors `knowledge/paths.ts` `slug()` so that the on-disk export tree
 * and the cache tree use the same naming convention. We re-encode here
 * (rather than re-using `slug()`) because the exporter is allowed to be
 * slightly more permissive — we keep dots (so e.g. `My.Func` → `My.Func`
 * if all chars are otherwise safe) since they're valid on every modern
 * filesystem.
 */
export function canonicalSlug(identity: string): string {
    let out = "";
    for (let i = 0; i < identity.length; i++) {
        const ch = identity.charAt(i);
        const code = identity.charCodeAt(i);
        const safe =
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5a) ||
            (code >= 0x61 && code <= 0x7a) ||
            ch === "-" || ch === "_" || ch === ".";
        if (safe) {
            out += ch;
        } else {
            // ES5 lib — no String.prototype.padStart. See knowledge/paths.ts.
            let hex = code.toString(16);
            while (hex.length < 4) hex = "0" + hex;
            out += "_" + hex;
        }
    }
    return out;
}

/** Filename for an importable's `.htsl` source file. */
export function htslFilename(importable: Importable): string {
    if (importable.type === "EVENT") {
        return canonicalSlug(importable.event) + ".htsl";
    }
    return canonicalSlug(importable.name) + ".htsl";
}

/** Default export root: `./htsw/exports/<housingUuid>/`. */
export function defaultExportRoot(housingUuid: string): string {
    return `./htsw/exports/${housingUuid}`;
}
