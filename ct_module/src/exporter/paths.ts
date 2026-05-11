import type { Importable } from "htsw/types";
import { encodeFilesystemComponent } from "../utils/filesystem";

/**
 * Filesystem-safe encoding for an importable's identity, used to derive
 * `.htsl` filenames during export.
 *
 * Export filenames are user-facing, so dots are preserved when the rest of
 * the name is filesystem-safe.
 */
export function canonicalSlug(identity: string): string {
    return encodeFilesystemComponent(identity.split(" ").join("_"), {
        escapeDots: false,
    });
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
