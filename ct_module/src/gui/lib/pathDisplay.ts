/// <reference types="../../../CTAutocomplete" />

import { javaType } from "./java";

// Shared path-shortening helpers used by the GUI. Display paths under
// `/projects/...` as if that directory were the user's root.

let cachedMcRoot: string | null = null;

// Rhino regex on CT 1.8.9 has been seen swallowing `/\\/g`-style replacements
// in production (the regex returns the input unchanged), so we use split/join
// for backslash conversion everywhere in this file.
function toForwardSlashes(s: string): string {
    return String(s).split("\\").join("/");
}

function basename(norm: string): string {
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function parentBasename(norm: string): string {
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return "";
    return basename(norm.substring(0, slash));
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

function projectPath(norm: string): string | null {
    const marker = "/projects/";
    const idx = norm.lastIndexOf(marker);
    if (idx >= 0) return norm.substring(idx);
    if (norm.indexOf("projects/") === 0) return `/${norm}`;
    return null;
}

function compactPathFromNormalized(norm: string): string {
    const project = projectPath(norm);
    if (project !== null) return project;
    const parts = norm.split("/");
    if (parts.length <= 2) return norm;
    return `.../${parts.slice(parts.length - 2).join("/")}`;
}

export function compactPath(p: string): string {
    return compactPathFromNormalized(normalizeHtswPath(p).split("\\").join("/"));
}

export function compactFileLabel(p: string): string {
    const norm = toForwardSlashes(p);
    const base = basename(norm);
    const lower = base.toLowerCase();
    if (lower === "import.json") {
        const parent = parentBasename(norm);
        return parent.length === 0 ? base : `${parent}.import.json`;
    }
    if (lower.lastIndexOf(".json") === lower.length - ".json".length) return base;
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
}

/**
 * Shorten an `import.json` path for a compact destination label. Drops a
 * trailing `/import.json` so the folder reads as the destination, not the file.
 */
export function shortPath(p: string): string {
    let norm = normalizeHtswPath(p).split("\\").join("/");
    const tail = "/import.json";
    if (norm.substring(norm.length - tail.length) === tail) {
        norm = norm.substring(0, norm.length - tail.length);
    }
    return compactPathFromNormalized(norm);
}
