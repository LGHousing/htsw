import * as json from "jsonc-parser";
import { encodeFilesystemComponent } from "../utils/filesystem";
import { findDeclaringImportJson, walkImportJsonTree } from "./includeWalk";

/**
 * The single workspace root: where projects live, where the GUI browses,
 * and where `/import` and `/export` anchor bare paths like
 * `roulette/import.json`. Relative to the Minecraft run directory.
 */
export const PROJECTS_ROOT = "./htsw/projects";

/**
 * Anchor a user-typed `/import` or `/export` path to PROJECTS_ROOT
 * unless it's already explicit: `./x`/`../x`, a POSIX absolute `/x`, or a
 * Windows drive `C:/x` pass through unchanged.
 */
export function resolveModuleRelativePath(path: string): string {
    if (path.length === 0) return path;
    const normalized = path.split("\\").join("/");
    if (normalized.charAt(0) === ".") return path;
    if (normalized.charAt(0) === "/") return path;
    if (/^[A-Za-z]:/.test(normalized)) return path;
    return `${PROJECTS_ROOT}/${normalized}`;
}

export function defaultExportRoot(housingUuid: string): string {
    return `${PROJECTS_ROOT}/${housingUuid}`;
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

// Aggregates across the whole include tree, so "export everything in the
// project" sees entries declared in included files too.
function readIdentitiesFromImportJson(
    importJsonPath: string,
    section: string,
    identityField: string
): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    walkImportJsonTree(importJsonPath, (_filePath, tree) => {
        const sectionNode = json.findNodeAtLocation(tree, [section]);
        if (!sectionNode || sectionNode.type !== "array") return undefined;
        const items = sectionNode.children ?? [];
        for (let i = 0; i < items.length; i++) {
            const nameNode = json.findNodeAtLocation(items[i], [identityField]);
            if (nameNode && nameNode.type === "string") {
                const name = String(nameNode.value);
                if (!seen.has(name)) {
                    seen.add(name);
                    names.push(name);
                }
            }
        }
        return undefined;
    });
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

export function parentDirOf(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    return norm.substring(0, slash);
}

/**
 * Where an exported function/event lands: the import.json that DECLARES the
 * identity (entry file for new ones) plus the htsl to write. Resolved as a
 * unit because the reference is relative to the declaring file — an
 * existing declaration keeps its file and htsl path; a new one gets a
 * fresh filename next to the entry import.json.
 */
export type HtslExportTarget = {
    importJsonPath: string;
    htslPath: string;
    htslReference: string;
};

function htslTargetForSection(
    entryImportJsonPath: string,
    section: string,
    identityField: string,
    identity: string,
    label: string
): HtslExportTarget {
    const importJsonPath =
        findDeclaringImportJson(entryImportJsonPath, section, identityField, identity) ??
        entryImportJsonPath;
    const refs = readActionReferencesForSection(importJsonPath, section, identityField, identity);
    const htslReference = pickHtslFilename(refs, identity, label);
    return {
        importJsonPath,
        htslPath: `${parentDirOf(importJsonPath)}/${htslReference}`,
        htslReference,
    };
}

export function htslTargetForFunctionExport(
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForSection(entryImportJsonPath, "functions", "name", identity, "function");
}

export function htslTargetForEventExport(
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForSection(entryImportJsonPath, "events", "event", identity, "event");
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

function readItemNbtReference(importJsonPath: string, itemName: string): string | null {
    if (!FileLib.exists(importJsonPath)) return null;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return null;
    const tree = json.parseTree(text);
    if (!tree) return null;
    const sectionNode = json.findNodeAtLocation(tree, ["items"]);
    if (!sectionNode || sectionNode.type !== "array") return null;
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const nameNode = json.findNodeAtLocation(items[i], ["name"]);
        if (!nameNode || nameNode.type !== "string" || nameNode.value !== itemName) continue;
        const nbtNode = json.findNodeAtLocation(items[i], ["nbt"]);
        if (nbtNode && nbtNode.type === "string") return String(nbtNode.value);
        return null;
    }
    return null;
}

/** Where an exported item lands — same contract as `HtslExportTarget`. */
export type SnbtExportTarget = {
    importJsonPath: string;
    snbtPath: string;
    snbtReference: string;
};

export function snbtTargetForItemExport(
    entryImportJsonPath: string,
    rootDir: string,
    itemName: string
): SnbtExportTarget {
    const declaring = findDeclaringImportJson(entryImportJsonPath, "items", "name", itemName);
    if (declaring !== null) {
        const existingRef = readItemNbtReference(declaring, itemName);
        const sanitized = existingRef !== null ? sanitizeRelativeReference(existingRef) : null;
        if (sanitized !== null) {
            return {
                importJsonPath: declaring,
                snbtPath: `${parentDirOf(declaring)}/${sanitized}`,
                snbtReference: sanitized,
            };
        }
        const itemsRoot = `${parentDirOf(declaring)}/items`;
        const filename = snbtFilenameForItemExport(itemsRoot, itemName);
        return {
            importJsonPath: declaring,
            snbtPath: `${itemsRoot}/${filename}`,
            snbtReference: `items/${filename}`,
        };
    }
    const itemsRoot = `${rootDir}/items`;
    const filename = snbtFilenameForItemExport(itemsRoot, itemName);
    return {
        importJsonPath: entryImportJsonPath,
        snbtPath: `${itemsRoot}/${filename}`,
        snbtReference: `items/${filename}`,
    };
}
