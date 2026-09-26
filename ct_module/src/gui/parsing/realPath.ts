/// <reference types="../../../CTAutocomplete" />

import { javaType } from "../lib/java";

let paths: HtswJavaPathsClass | null = null;

/**
 * Resolves a path to the filesystem's own spelling. On Windows one file is
 * reachable under differently cased, relative and absolute spellings, which
 * once opened the same project as two sources. Stateless so the parse worker
 * can call it off the client thread; `canonicalPath` memoizes it.
 */
export function resolveCanonicalPath(p: string): string {
    try {
        if (paths === null) paths = javaType("java.nio.file.Paths");
        const abs = paths.get(p).toAbsolutePath();
        let resolved: HtswJavaPath;
        try {
            resolved = abs.toRealPath();
        } catch (_e) {
            // File doesn't exist yet: fall back to lexical normalization.
            resolved = abs.normalize();
        }
        return String(resolved.toString()).split("\\").join("/");
    } catch (_e) {
        return p.split("\\").join("/");
    }
}

export function resolveCanonicalPaths(fingerprint: { [path: string]: number }): {
    [path: string]: string;
} {
    const out: { [path: string]: string } = {};
    for (const path in fingerprint) {
        if (!Object.prototype.hasOwnProperty.call(fingerprint, path)) continue;
        out[path] = resolveCanonicalPath(path);
    }
    return out;
}
