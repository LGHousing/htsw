import type { Importable } from "htsw/types";
import * as json from "jsonc-parser";
import { encodeFilesystemComponent } from "../utils/filesystem";

/**
 * The module's `imports/` folder — the default workspace where HTSW
 * users keep their `.htsl` projects. Both `/export` defaults and the
 * relative-path resolution for `/import` anchor here so users can
 * type bare project names like `htswtest` or `htswtest/import.json`
 * and have them land where they expect.
 *
 * Matches the deploy path hardcoded in `recompile.ts` and
 * `injectLong.ts`. If `install.py` ever ships under a different
 * module name, this needs to change too.
 */
export const MODULE_IMPORTS_ROOT =
    "./config/ChatTriggers/modules/HTSW/imports";

/**
 * Resolve a user-typed path arg from `/import` or `/export` against the
 * CT module's imports folder when it's bare or simple-relative. Lets
 * the user type `htswtest` or `htswtest/import.json` and get the file
 * inside `<MC>/config/ChatTriggers/modules/HTSW/imports/...`, which
 * is typically symlinked to a vault folder.
 *
 * Pass-through cases (keep today's semantics):
 *   - `./x`, `../x`     — explicit MC-root-relative
 *   - `/x`               — POSIX absolute
 *   - `C:/x`, `D:/x`     — Windows drive-letter absolute
 *
 * Anything else (`htswtest`, `htswtest/import.json`, `subdir/foo.json`)
 * is prepended with the imports root.
 */
export function resolveModuleRelativePath(path: string): string {
    if (path.length === 0) return path;
    const normalized = path.split("\\").join("/");
    if (normalized.charAt(0) === ".") return path; // ./x, ../x
    if (normalized.charAt(0) === "/") return path; // /abs
    if (/^[A-Za-z]:/.test(normalized)) return path; // C:/x
    return `${MODULE_IMPORTS_ROOT}/${normalized}`;
}

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

/**
 * Read the `functions[].name` array from an `import.json` in declaration
 * order. Returns `[]` if the file doesn't exist, is empty, isn't valid
 * JSON(C), or has no `functions` section. Used by `/export import.json`
 * to drive a re-export pass over a known subset of functions.
 */
export function readFunctionNamesFromImportJson(importJsonPath: string): string[] {
    const names: string[] = [];
    if (!FileLib.exists(importJsonPath)) return names;

    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return names;

    const tree = json.parseTree(text);
    if (!tree) return names;

    const sectionNode = json.findNodeAtLocation(tree, ["functions"]);
    if (!sectionNode || sectionNode.type !== "array") return names;

    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const nameNode = json.findNodeAtLocation(items[i], ["name"]);
        if (nameNode && nameNode.type === "string") {
            names.push(String(nameNode.value));
        }
    }
    return names;
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

/**
 * Default export root.
 *
 * Lands inside the CT module's `imports/` folder under a per-housing UUID
 * subfolder. This mirrors where source `.htsl` files already live for
 * `/import`, so a captured housing's export is immediately available as
 * its own importable project rooted alongside the user's other ones.
 */
export function defaultExportRoot(housingUuid: string): string {
    return `${MODULE_IMPORTS_ROOT}/${housingUuid}`;
}

/**
 * Pick a filename for a captured item's `.snbt` file inside the export's
 * `items/` directory. Mirrors the function-filename approach but doesn't
 * scan `import.json` for existing references — items are emitted whole
 * per export run, so the source of truth for collision avoidance is the
 * filesystem itself.
 *
 * Returns just the basename (e.g. `"diamond_sword.snbt"`); the caller
 * joins it with `<rootDir>/items/` to form the absolute path and stores
 * `"items/<basename>"` as the `nbt` reference in `import.json`.
 */
export function snbtFilenameForItemExport(
    itemsRootDir: string,
    identity: string
): string {
    const slug = canonicalSlug(identity);
    const preferred = `${slug}.snbt`;
    if (!FileLib.exists(`${itemsRootDir}/${preferred}`)) {
        return preferred;
    }

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.snbt`;
        if (!FileLib.exists(`${itemsRootDir}/${candidate}`)) {
            return candidate;
        }
    }

    throw new Error(`Could not find an unused .snbt filename for item "${identity}".`);
}
