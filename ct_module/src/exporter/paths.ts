import * as json from "jsonc-parser";
import { encodeFilesystemComponent } from "../utils/filesystem";

/**
 * Default workspace root for `/import` and `/export`. Bare, simple-relative
 * paths anchor here so users can type `roulette/import.json` and reach the
 * symlinked vault folder rather than a Minecraft-root-relative path.
 */
export const MODULE_IMPORTS_ROOT =
    "./config/ChatTriggers/modules/HTSW/imports";

/**
 * Anchor a user-typed `/import` or `/export` path to MODULE_IMPORTS_ROOT
 * unless it's already explicit: `./x`/`../x`, a POSIX absolute `/x`, or a
 * Windows drive `C:/x` pass through unchanged.
 */
export function resolveModuleRelativePath(path: string): string {
    if (path.length === 0) return path;
    const normalized = path.split("\\").join("/");
    if (normalized.charAt(0) === ".") return path;
    if (normalized.charAt(0) === "/") return path;
    if (/^[A-Za-z]:/.test(normalized)) return path;
    return `${MODULE_IMPORTS_ROOT}/${normalized}`;
}

export function defaultExportRoot(housingUuid: string): string {
    return `${MODULE_IMPORTS_ROOT}/${housingUuid}`;
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

function readIdentitiesFromImportJson(
    importJsonPath: string,
    section: string,
    identityField: string
): string[] {
    const names: string[] = [];
    if (!FileLib.exists(importJsonPath)) return names;

    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return names;

    const tree = json.parseTree(text);
    if (!tree) return names;

    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return names;

    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const nameNode = json.findNodeAtLocation(items[i], [identityField]);
        if (nameNode && nameNode.type === "string") {
            names.push(String(nameNode.value));
        }
    }
    return names;
}

export function readFunctionNamesFromImportJson(importJsonPath: string): string[] {
    return readIdentitiesFromImportJson(importJsonPath, "functions", "name");
}

export function readEventNamesFromImportJson(importJsonPath: string): string[] {
    return readIdentitiesFromImportJson(importJsonPath, "events", "event");
}

function readActionReferencesForSection(
    importJsonPath: string,
    section: string,
    identityField: string,
    identity: string
): { current: string | null; usedByOthers: Set<string> } {
    const result = { current: null as string | null, usedByOthers: new Set<string>() };
    if (!FileLib.exists(importJsonPath)) return result;

    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return result;

    const tree = json.parseTree(text);
    if (!tree) return result;

    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return result;

    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const nameNode = json.findNodeAtLocation(item, [identityField]);
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

function pickHtslFilename(
    refs: { current: string | null; usedByOthers: Set<string> },
    identity: string,
    label: string
): string {
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

    throw new Error(`Could not find an unused filename for ${label} "${identity}".`);
}

export function htslFilenameForFunctionExport(
    importJsonPath: string,
    identity: string
): string {
    const refs = readActionReferencesForSection(importJsonPath, "functions", "name", identity);
    return pickHtslFilename(refs, identity, "function");
}

export function htslFilenameForEventExport(
    importJsonPath: string,
    identity: string
): string {
    const refs = readActionReferencesForSection(importJsonPath, "events", "event", identity);
    return pickHtslFilename(refs, identity, "event");
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

export function snbtFilenameForItemExport(
    itemsRoot: string,
    itemName: string
): string {
    const slug = canonicalSlug(itemName);
    const preferred = `${slug}.snbt`;
    if (!FileLib.exists(`${itemsRoot}/${preferred}`)) return preferred;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.snbt`;
        if (!FileLib.exists(`${itemsRoot}/${candidate}`)) return candidate;
    }

    throw new Error(`Could not find an unused SNBT filename for item "${itemName}".`);
}
