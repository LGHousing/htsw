/// <reference types="../../../CTAutocomplete" />

import { normalizePathSeparators } from "htsw-editor-common/project";
import { normalizeHtswPath } from "../../project/htswPath";

// Shared path-shortening helpers used by the GUI. Display paths under
// `/projects/...` as if that directory were the user's root.

export { normalizeHtswPath };

/** Lowercased forward-slash form — the key to use for path comparisons. */
function pathKey(p: string): string {
    return normalizePathSeparators(p).toLowerCase();
}

export function hasExt(p: string, ext: string): boolean {
    return endsWith(pathKey(p), `.${ext.toLowerCase()}`);
}

export function basename(p: string): string {
    const norm = normalizePathSeparators(p);
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

export function dirname(p: string): string {
    const norm = normalizePathSeparators(p);
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? "" : norm.substring(0, slash);
}

function parentBasename(norm: string): string {
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return "";
    return basename(norm.substring(0, slash));
}

function endsWith(s: string, suffix: string): boolean {
    return s.length >= suffix.length && s.substring(s.length - suffix.length) === suffix;
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
    return compactPathFromNormalized(normalizePathSeparators(normalizeHtswPath(p)));
}

export function compactFileLabel(p: string): string {
    const norm = normalizePathSeparators(p);
    const base = basename(norm);
    const lower = base.toLowerCase();
    if (lower === "import.json") {
        const parent = parentBasename(norm);
        return parent.length === 0 ? base : `${parent}.import.json`;
    }
    if (endsWith(lower, ".json")) return base;
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
}

/**
 * Shorten an `import.json` path for a compact destination label. Drops a
 * trailing `/import.json` so the folder reads as the destination, not the file.
 */
export function shortPath(p: string): string {
    let norm = normalizePathSeparators(normalizeHtswPath(p));
    const tail = "/import.json";
    if (endsWith(norm, tail)) {
        norm = norm.substring(0, norm.length - tail.length);
    }
    return compactPathFromNormalized(norm);
}
