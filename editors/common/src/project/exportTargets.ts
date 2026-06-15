import * as json from "jsonc-parser";
import { findDeclaringImportJson, walkImportJsonTree } from "./includeWalk";
import { canonicalSlug } from "./filenames";
import { joinPath, type ProjectFs } from "./fs";

export function readIdentitiesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string,
    section: string,
    identityField: string
): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    walkImportJsonTree(fs, importJsonPath, (_filePath, tree) => {
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

export function readFunctionNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "functions", "name");
}

export function readEventNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "events", "event");
}

function readActionReferencesForSection(
    fs: ProjectFs,
    importJsonPath: string,
    section: string,
    identityField: string,
    identity: string
): { current: string | null; usedByOthers: Set<string> } {
    const result = { current: null as string | null, usedByOthers: new Set<string>() };
    if (!fs.exists(importJsonPath)) return result;

    const text = fs.readFile(importJsonPath);
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
    }

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

export type HtslExportTarget = {
    importJsonPath: string;
    htslPath: string;
    htslReference: string;
};

function htslTargetForSection(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: string,
    identityField: string,
    identity: string,
    label: string
): HtslExportTarget {
    const importJsonPath =
        findDeclaringImportJson(fs, entryImportJsonPath, section, identityField, identity) ??
        entryImportJsonPath;
    const refs = readActionReferencesForSection(
        fs,
        importJsonPath,
        section,
        identityField,
        identity
    );
    const htslReference = pickHtslFilename(refs, identity, label);
    return {
        importJsonPath,
        htslPath: fs.resolvePath(fs.parentDir(importJsonPath), htslReference),
        htslReference,
    };
}

export function htslTargetForFunctionExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForSection(
        fs,
        entryImportJsonPath,
        "functions",
        "name",
        identity,
        "function"
    );
}

export function htslTargetForEventExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    identity: string
): HtslExportTarget {
    return htslTargetForSection(
        fs,
        entryImportJsonPath,
        "events",
        "event",
        identity,
        "event"
    );
}

export function sanitizeRelativeReference(raw: string): string | null {
    if (raw.length === 0) return null;
    const normalized = raw.replace(/\\/g, "/");
    if (normalized.charAt(0) === "/") return null;
    if (/^[A-Za-z]:\//.test(normalized)) return null;

    const segments = normalized.split("/");
    for (let i = 0; i < segments.length; i++) {
        if (segments[i] === "..") return null;
    }

    return normalized;
}

export function snbtFilenameForItemExport(
    fs: ProjectFs,
    itemsRoot: string,
    itemName: string
): string {
    const slug = canonicalSlug(itemName);
    const preferred = `${slug}.snbt`;
    if (!fs.exists(joinPath(itemsRoot, preferred))) return preferred;

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.snbt`;
        if (!fs.exists(joinPath(itemsRoot, candidate))) return candidate;
    }

    throw new Error(`Could not find an unused SNBT filename for item "${itemName}".`);
}

function readItemNbtReference(
    fs: ProjectFs,
    importJsonPath: string,
    itemName: string
): string | null {
    if (!fs.exists(importJsonPath)) return null;
    const text = fs.readFile(importJsonPath);
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

export type SnbtExportTarget = {
    importJsonPath: string;
    snbtPath: string;
    snbtReference: string;
};

export function snbtTargetForItemExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    rootDir: string,
    itemName: string
): SnbtExportTarget {
    const declaring = findDeclaringImportJson(
        fs,
        entryImportJsonPath,
        "items",
        "name",
        itemName
    );
    if (declaring !== null) {
        const existingRef = readItemNbtReference(fs, declaring, itemName);
        const sanitized = existingRef !== null ? sanitizeRelativeReference(existingRef) : null;
        if (sanitized !== null) {
            return {
                importJsonPath: declaring,
                snbtPath: fs.resolvePath(fs.parentDir(declaring), sanitized),
                snbtReference: sanitized,
            };
        }
        const itemsRoot = fs.resolvePath(fs.parentDir(declaring), "items");
        const filename = snbtFilenameForItemExport(fs, itemsRoot, itemName);
        return {
            importJsonPath: declaring,
            snbtPath: fs.resolvePath(itemsRoot, filename),
            snbtReference: `items/${filename}`,
        };
    }
    const itemsRoot = fs.resolvePath(rootDir, "items");
    const filename = snbtFilenameForItemExport(fs, itemsRoot, itemName);
    return {
        importJsonPath: entryImportJsonPath,
        snbtPath: fs.resolvePath(itemsRoot, filename),
        snbtReference: `items/${filename}`,
    };
}
