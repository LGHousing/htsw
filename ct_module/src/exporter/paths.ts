import type { Importable } from "htsw/types";
import * as json from "jsonc-parser";
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

function readFunctionActionReferences(
    importJsonPath: string,
    identity: string
): { current: string | null; usedByOthers: Set<string> } {
    const result = { current: null as string | null, usedByOthers: new Set<string>() };
    if (!FileLib.exists(importJsonPath)) return result;

    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return result;

    const tree = json.parseTree(text);
    if (!tree) return result;

    const sectionNode = json.findNodeAtLocation(tree, ["functions"]);
    if (!sectionNode || sectionNode.type !== "array") return result;

    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const nameNode = json.findNodeAtLocation(item, ["name"]);
        const actionsNode = json.findNodeAtLocation(item, ["actions"]);
        if (
            !nameNode ||
            nameNode.type !== "string" ||
            !actionsNode ||
            actionsNode.type !== "string"
        ) {
            continue;
        }

        const ref = String(actionsNode.value);
        if (nameNode.value === identity) {
            result.current = ref;
        } else {
            result.usedByOthers.add(ref);
        }
    }

    return result;
}

export function htslFilenameForFunctionExport(
    importJsonPath: string,
    identity: string
): string {
    const refs = readFunctionActionReferences(importJsonPath, identity);
    if (refs.current !== null) {
        const sanitized = sanitizeRelativeReference(refs.current);
        if (sanitized !== null) return sanitized;
        // Fall through to the canonical-slug strategy if the existing
        // reference is unsafe (absolute path or contains `..`). Better to
        // pick a new safe filename than to obey a malformed import.json
        // entry and let it escape the export root.
    }

    // Lowercase comparison set so a case-insensitive filesystem (Windows
    // NTFS, macOS APFS default) doesn't let `My_Func.htsl` slip past while
    // `my_func.htsl` already exists on disk — they collide as files even
    // though the strings differ. Returned name keeps its original casing.
    const usedLower = new Set<string>();
    refs.usedByOthers.forEach((name) => usedLower.add(name.toLowerCase()));

    const slug = canonicalSlug(identity);
    const preferred = `${slug}.htsl`;
    if (!usedLower.has(preferred.toLowerCase())) return preferred;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.htsl`;
        if (!usedLower.has(candidate.toLowerCase())) return candidate;
    }

    throw new Error(`Could not find an unused filename for function "${identity}".`);
}

/**
 * Validate a path read from `import.json` before joining it onto the export
 * root. Returns the normalized relative path, or null if the value is unsafe
 * (absolute, contains `..`, or empty). Subdirectories are allowed — callers
 * are responsible for `mkdirs` before writing.
 */
function sanitizeRelativeReference(raw: string): string | null {
    if (raw.length === 0) return null;
    const normalized = raw.replace(/\\/g, "/");

    // Absolute paths: posix-style leading slash, or Windows drive prefix.
    if (normalized.charAt(0) === "/") return null;
    if (/^[A-Za-z]:\//.test(normalized)) return null;

    // Parent traversal anywhere in the path.
    const segments = normalized.split("/");
    for (let i = 0; i < segments.length; i++) {
        if (segments[i] === "..") return null;
    }

    return normalized;
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
