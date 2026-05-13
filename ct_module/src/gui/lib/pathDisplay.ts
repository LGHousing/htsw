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
 * Compact a path by keeping only the last `n` segments, joined by `/`.
 * Used by Explore's row labels — no `~/` prefix, no MC-root anchoring,
 * just the last few directories so a deep absolute path renders as
 * `bar/baz/file.htsl` rather than `C:/long/winding/path/.../file.htsl`.
 */
export function tailSegments(p: string, n: number): string {
    if (p === undefined || p === null || p === "") return p;
    const norm = toForwardSlashes(p);
    const parts = norm.split("/").filter((s) => s.length > 0);
    if (parts.length <= n) return parts.join("/");
    return parts.slice(parts.length - n).join("/");
}
