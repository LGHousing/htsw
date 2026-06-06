/// <reference types="../../CTAutocomplete" />

import { javaType } from "./java";

// Shared path-shortening helpers used by both the topbar Input and the
// right-pane source-preview header. Both places want paths that read as
// `./htsw/imports/...` rather than the raw absolute Windows form.

let cachedMcRoot: string | null = null;

// Rhino regex on CT 1.8.9 has been seen swallowing `/\\/g`-style replacements
// in production (the regex returns the input unchanged), so we use split/join
// for backslash conversion everywhere in this file.
function toForwardSlashes(s: string): string {
    return String(s).split("\\").join("/");
}

function mcRoot(): string {
    if (cachedMcRoot !== null) return cachedMcRoot;
    try {
        const Paths = javaType("java.nio.file.Paths");
        cachedMcRoot = toForwardSlashes(
            Paths.get(".").toAbsolutePath().normalize().toString()
        );
    } catch (_e) {
        cachedMcRoot = "";
    }
    return cachedMcRoot;
}

/**
 * Normalize a path for storage / display. If the path passes through `/htsw/`
 * we anchor it there (`./htsw/...`); otherwise we relativize against the MC
 * root. The result always uses forward slashes.
 *
 * Used by `setImportJsonPath` so absolute paths (typed in or returned from
 * the file browser) collapse to the canonical `./htsw/...` form.
 */
export function normalizeHtswPath(p: string): string {
    if (p === undefined || p === null) return p;
    const norm = toForwardSlashes(p);
    const idx = norm.lastIndexOf("/htsw/");
    if (idx >= 0) return `.${norm.substring(idx)}`;
    const root = mcRoot();
    if (root.length > 0 && norm.length > root.length) {
        if (norm.substring(0, root.length + 1) === `${root}/`) {
            return `./${norm.substring(root.length + 1)}`;
        }
    }
    if (root.length > 0 && norm === root) return ".";
    return norm;
}

/**
 * Shorten an `import.json` path to its last two directory segments for a
 * compact label (e.g. `.../my-house/release`). Drops a trailing
 * `/import.json` so the folder reads as the destination, not the file.
 */
export function shortPath(p: string): string {
    let norm = normalizeHtswPath(p).split("\\").join("/");
    const tail = "/import.json";
    if (norm.substring(norm.length - tail.length) === tail) {
        norm = norm.substring(0, norm.length - tail.length);
    }
    const parts = norm.split("/");
    if (parts.length <= 2) return norm;
    return `.../${parts.slice(parts.length - 2).join("/")}`;
}

/**
 * Shorten an arbitrary text (typically a diagnostic message or file path)
 * for display by collapsing the MC-root prefix to `./` and truncating to
 * `maxLen` characters with an ellipsis. Used by source viewers and error
 * lines so absolute paths don't blow out the gutter width.
 */
export function shortenForDisplay(text: string, maxLen: number): string {
    let s = text;
    const root = mcRoot();
    if (root.length > 0) {
        const rootBack = root.split("/").join("\\");
        s = s.split(`${root}/`).join("./");
        s = s.split(`${root}\\`).join("./");
        s = s.split(rootBack).join("./");
    }
    if (s.length > maxLen) {
        return `${s.substring(0, maxLen - 1)}…`;
    }
    return s;
}