import * as json from "jsonc-parser";
import { findDeclaringImportJson, walkImportJsonTree } from "./includeWalk";
import { canonicalSlug } from "./filenames";
import { joinPath, normalizePathSeparators, type ProjectFs } from "./fs";
import {
    importableEntryMatchesIdentity,
    findDeclaringImportJsonForSection,
    npcPosIdentity,
    type Section,
} from "./importJsonMutations";
import { sectionFolderImportJson } from "./sectionLayout";

export type PosLike = { x: number; y: number; z: number };

export type NpcExportEntry = {
    name: string;
    pos: PosLike;
};

export type SectionFolderImportJsonResolver = (
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section
) => string | null;

// Resolve a path to the fs's own canonical form before comparing. The include
// walk yields whatever `fs.resolvePath`/`parentDir` produce (absolute, OS
// separators under the real ct fs), while a sticky target comes in relative
// (`./htsw/...`), so a raw string compare would never match in game.
function fsCanonicalKey(fs: ProjectFs, path: string): string {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const base = slash < 0 ? path : path.substring(slash + 1);
    return fs.pathKey(fs.resolvePath(fs.parentDir(path), base));
}

// The sticky "new exports land here" file chosen for a destination, but only
// honored when the entry's include tree actually reaches it — a stale choice
// pointing at a no-longer-included file must not write a file the parse can't
// see. Returns the tree's own path form so callers resolve against it directly.
function reachablePreferredTarget(
    fs: ProjectFs,
    entryImportJsonPath: string,
    preferredNewTargetImportJson: string | undefined
): string | null {
    if (preferredNewTargetImportJson === undefined || preferredNewTargetImportJson.trim() === "") {
        return null;
    }
    const preferredKey = fsCanonicalKey(fs, preferredNewTargetImportJson);
    let matched: string | null = null;
    walkImportJsonTree(fs, entryImportJsonPath, (filePath) => {
        if (fsCanonicalKey(fs, filePath) === preferredKey) {
            matched = filePath;
            return true;
        }
        return undefined;
    });
    return matched;
}

function nodeNumber(node: json.Node | undefined): number | null {
    return node && node.type === "number" ? Number(node.value) : null;
}

function readPosFromNode(node: json.Node): PosLike | null {
    const x = nodeNumber(json.findNodeAtLocation(node, ["pos", "x"]));
    const y = nodeNumber(json.findNodeAtLocation(node, ["pos", "y"]));
    const z = nodeNumber(json.findNodeAtLocation(node, ["pos", "z"]));
    if (x === null || y === null || z === null) return null;
    return { x, y, z };
}

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

export function readRegionNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "regions", "name");
}

export function readMenuNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "menus", "name");
}

export function readCommandNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "commands", "name");
}

export function readTeamNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "teams", "name");
}

export function readGroupNamesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): string[] {
    return readIdentitiesFromImportJson(fs, importJsonPath, "groups", "name");
}

export function readNpcEntriesFromImportJson(
    fs: ProjectFs,
    importJsonPath: string
): NpcExportEntry[] {
    const entries: NpcExportEntry[] = [];
    const seen = new Set<string>();
    walkImportJsonTree(fs, importJsonPath, (_filePath, tree) => {
        const sectionNode = json.findNodeAtLocation(tree, ["npcs"]);
        if (!sectionNode || sectionNode.type !== "array") return undefined;
        const items = sectionNode.children ?? [];
        for (let i = 0; i < items.length; i++) {
            const nameNode = json.findNodeAtLocation(items[i], ["name"]);
            const pos = readPosFromNode(items[i]);
            if (!nameNode || nameNode.type !== "string" || pos === null) continue;
            const identity = npcPosIdentity(pos);
            if (seen.has(identity)) continue;
            seen.add(identity);
            entries.push({ name: String(nameNode.value), pos });
        }
        return undefined;
    });
    return entries;
}

function readDeclaringImportableNode(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: string,
    identityField: string,
    identity: string
): { importJsonPath: string; node: json.Node } | null {
    const importJsonPath = findDeclaringImportJson(
        fs,
        entryImportJsonPath,
        section,
        identityField,
        identity
    );
    if (importJsonPath === null) return null;
    if (!fs.exists(importJsonPath)) return null;

    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") return null;
    const tree = json.parseTree(text);
    if (!tree) return null;

    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return null;
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const idNode = json.findNodeAtLocation(item, [identityField]);
        if (idNode && idNode.type === "string" && idNode.value === identity) {
            return { importJsonPath, node: item };
        }
    }

    return null;
}

function readDeclaringNpcNode(
    fs: ProjectFs,
    entryImportJsonPath: string,
    pos: PosLike
): { importJsonPath: string; node: json.Node } | null {
    let result: { importJsonPath: string; node: json.Node } | null = null;
    const identity = npcPosIdentity(pos);
    walkImportJsonTree(fs, entryImportJsonPath, (filePath, tree) => {
        const sectionNode = json.findNodeAtLocation(tree, ["npcs"]);
        if (!sectionNode || sectionNode.type !== "array") return undefined;
        const items = sectionNode.children ?? [];
        for (let i = 0; i < items.length; i++) {
            if (importableEntryMatchesIdentity("npcs", items[i], identity)) {
                result = { importJsonPath: filePath, node: items[i] };
                return true;
            }
        }
        return undefined;
    });
    return result;
}

function referencedFileExists(
    fs: ProjectFs,
    importJsonPath: string,
    ref: string
): boolean {
    const sanitized = sanitizeRelativeReference(ref);
    if (sanitized === null) return false;
    return fs.exists(fs.resolvePath(fs.parentDir(importJsonPath), sanitized));
}

function requiredStringReferenceExists(
    fs: ProjectFs,
    importJsonPath: string,
    node: json.Node,
    field: string
): boolean {
    const refNode = json.findNodeAtLocation(node, [field]);
    if (!refNode || refNode.type !== "string") return false;
    return referencedFileExists(fs, importJsonPath, String(refNode.value));
}

function optionalStringReferenceExists(
    fs: ProjectFs,
    importJsonPath: string,
    node: json.Node,
    field: string
): boolean {
    const refNode = json.findNodeAtLocation(node, [field]);
    if (!refNode) return true;
    if (refNode.type !== "string") return false;
    return referencedFileExists(fs, importJsonPath, String(refNode.value));
}

function actionFileExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    section: string,
    identityField: string,
    identity: string
): boolean {
    const entry = readDeclaringImportableNode(
        fs,
        importJsonPath,
        section,
        identityField,
        identity
    );
    if (entry === null) return false;
    return requiredStringReferenceExists(fs, entry.importJsonPath, entry.node, "actions");
}

export function functionExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    name: string
): boolean {
    return actionFileExportReferencesExist(
        fs,
        importJsonPath,
        "functions",
        "name",
        name
    );
}

export function eventExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    event: string
): boolean {
    return actionFileExportReferencesExist(
        fs,
        importJsonPath,
        "events",
        "event",
        event
    );
}

export function commandExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    name: string
): boolean {
    return actionFileExportReferencesExist(
        fs,
        importJsonPath,
        "commands",
        "name",
        name
    );
}

export function npcExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    pos: PosLike
): boolean {
    const entry = readDeclaringNpcNode(fs, importJsonPath, pos);
    if (entry === null) return false;
    return (
        optionalStringReferenceExists(
            fs,
            entry.importJsonPath,
            entry.node,
            "leftClickActions"
        ) &&
        optionalStringReferenceExists(
            fs,
            entry.importJsonPath,
            entry.node,
            "rightClickActions"
        )
    );
}

export function regionExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    name: string
): boolean {
    const entry = readDeclaringImportableNode(
        fs,
        importJsonPath,
        "regions",
        "name",
        name
    );
    if (entry === null) return false;
    const boundsNode = json.findNodeAtLocation(entry.node, ["bounds"]);
    if (!boundsNode) return false;
    return (
        optionalStringReferenceExists(
            fs,
            entry.importJsonPath,
            entry.node,
            "onEnterActions"
        ) &&
        optionalStringReferenceExists(
            fs,
            entry.importJsonPath,
            entry.node,
            "onExitActions"
        )
    );
}

export function teamExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    name: string
): boolean {
    // Teams write only their import.json entry — no external .htsl/.snbt files —
    // so a declared entry is already a complete export.
    return readDeclaringImportableNode(fs, importJsonPath, "teams", "name", name) !== null;
}

export function menuExportReferencesExist(
    fs: ProjectFs,
    importJsonPath: string,
    name: string
): boolean {
    const entry = readDeclaringImportableNode(
        fs,
        importJsonPath,
        "menus",
        "name",
        name
    );
    if (entry === null) return false;

    const slotsNode = json.findNodeAtLocation(entry.node, ["slots"]);
    if (!slotsNode || slotsNode.type !== "array") return false;
    const slots = slotsNode.children ?? [];
    for (let i = 0; i < slots.length; i++) {
        if (!requiredStringReferenceExists(fs, entry.importJsonPath, slots[i], "nbt")) {
            return false;
        }
        if (!optionalStringReferenceExists(fs, entry.importJsonPath, slots[i], "actions")) {
            return false;
        }
    }
    return true;
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

export type RegionHtslExportTargets = {
    importJsonPath: string;
    onEnter: HtslExportTarget;
    onExit: HtslExportTarget;
};

export type NpcHtslExportTargets = {
    importJsonPath: string;
    leftClick: HtslExportTarget;
    rightClick: HtslExportTarget;
};

// Which import.json a section entry's export lands in: the file that already
// declares it, else the section's folder file when the project uses that
// layout, else the entry file itself. Types with no on-disk `.htsl`/`.snbt`
// (teams) route with this directly; the file-emitting types build their target
// path on top of it.
export function importJsonTargetForSectionEntry(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section,
    identity: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver: SectionFolderImportJsonResolver = sectionFolderImportJson
): string {
    const declared = findDeclaringImportJsonForSection(
        fs,
        entryImportJsonPath,
        section,
        identity
    );
    if (declared !== null) return declared;
    const preferred = reachablePreferredTarget(
        fs,
        entryImportJsonPath,
        preferredNewTargetImportJson
    );
    if (preferred !== null) return preferred;
    return sectionFolderResolver(fs, entryImportJsonPath, section) ?? entryImportJsonPath;
}

function htslTargetForSection(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section,
    identityField: string,
    identity: string,
    label: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver: SectionFolderImportJsonResolver = sectionFolderImportJson
): HtslExportTarget {
    const importJsonPath = importJsonTargetForSectionEntry(
        fs,
        entryImportJsonPath,
        section,
        identity,
        preferredNewTargetImportJson,
        sectionFolderResolver
    );
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
    identity: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver?: SectionFolderImportJsonResolver
): HtslExportTarget {
    return htslTargetForSection(
        fs,
        entryImportJsonPath,
        "functions",
        "name",
        identity,
        "function",
        preferredNewTargetImportJson,
        sectionFolderResolver
    );
}

export function htslTargetForEventExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    identity: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver?: SectionFolderImportJsonResolver
): HtslExportTarget {
    return htslTargetForSection(
        fs,
        entryImportJsonPath,
        "events",
        "event",
        identity,
        "event",
        preferredNewTargetImportJson,
        sectionFolderResolver
    );
}

export function htslTargetForCommandExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    identity: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver?: SectionFolderImportJsonResolver
): HtslExportTarget {
    return htslTargetForSection(
        fs,
        entryImportJsonPath,
        "commands",
        "name",
        identity,
        "command",
        preferredNewTargetImportJson,
        sectionFolderResolver
    );
}

function readActionReferencesForFields(
    fs: ProjectFs,
    importJsonPath: string,
    section: string,
    identityField: string,
    identity: string,
    fields: readonly string[]
): { current: Record<string, string | null>; usedByOthers: Set<string> } {
    const current: Record<string, string | null> = {};
    for (let i = 0; i < fields.length; i++) current[fields[i]] = null;
    const result = { current, usedByOthers: new Set<string>() };
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
        if (!nameNode || nameNode.type !== "string") continue;

        for (let f = 0; f < fields.length; f++) {
            const field = fields[f];
            const refNode = json.findNodeAtLocation(item, [field]);
            if (!refNode || refNode.type !== "string") continue;
            const ref = String(refNode.value);
            if (nameNode.value === identity) {
                current[field] = ref;
            } else {
                result.usedByOthers.add(ref);
            }
        }
    }

    return result;
}

function pickHtslFilenameFromBase(
    current: string | null,
    usedLower: Set<string>,
    baseName: string,
    label: string
): string {
    if (current !== null) {
        const sanitized = sanitizeRelativeReference(current);
        if (sanitized !== null) {
            const lower = sanitized.toLowerCase();
            if (!usedLower.has(lower)) {
                usedLower.add(lower);
                return sanitized;
            }
        }
    }

    const slug = canonicalSlug(baseName);
    const preferred = `${slug}.htsl`;
    if (!usedLower.has(preferred.toLowerCase())) {
        usedLower.add(preferred.toLowerCase());
        return preferred;
    }

    for (let i = 2; i < 1000; i++) {
        const candidate = `${slug}_${i}.htsl`;
        if (!usedLower.has(candidate.toLowerCase())) {
            usedLower.add(candidate.toLowerCase());
            return candidate;
        }
    }

    throw new Error(`Could not find an unused filename for ${label}.`);
}

export function htslTargetsForRegionExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    identity: string,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver: SectionFolderImportJsonResolver = sectionFolderImportJson
): RegionHtslExportTargets {
    const importJsonPath = importJsonTargetForSectionEntry(
        fs,
        entryImportJsonPath,
        "regions",
        identity,
        preferredNewTargetImportJson,
        sectionFolderResolver
    );
    const refs = readActionReferencesForFields(
        fs,
        importJsonPath,
        "regions",
        "name",
        identity,
        ["onEnterActions", "onExitActions"]
    );
    const usedLower = new Set<string>();
    refs.usedByOthers.forEach((name) => usedLower.add(name.toLowerCase()));

    const onEnterReference = pickHtslFilenameFromBase(
        refs.current.onEnterActions,
        usedLower,
        `${identity}_enter`,
        `region entry actions for "${identity}"`
    );
    const onExitReference = pickHtslFilenameFromBase(
        refs.current.onExitActions,
        usedLower,
        `${identity}_exit`,
        `region exit actions for "${identity}"`
    );
    const dir = fs.parentDir(importJsonPath);
    return {
        importJsonPath,
        onEnter: {
            importJsonPath,
            htslPath: fs.resolvePath(dir, onEnterReference),
            htslReference: onEnterReference,
        },
        onExit: {
            importJsonPath,
            htslPath: fs.resolvePath(dir, onExitReference),
            htslReference: onExitReference,
        },
    };
}

function readActionReferencesForNpc(
    fs: ProjectFs,
    importJsonPath: string,
    pos: PosLike,
    fields: readonly string[]
): { current: Record<string, string | null>; usedByOthers: Set<string> } {
    const current: Record<string, string | null> = {};
    for (let i = 0; i < fields.length; i++) current[fields[i]] = null;
    const result = { current, usedByOthers: new Set<string>() };
    if (!fs.exists(importJsonPath)) return result;

    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") return result;

    const tree = json.parseTree(text);
    if (!tree) return result;

    const sectionNode = json.findNodeAtLocation(tree, ["npcs"]);
    if (!sectionNode || sectionNode.type !== "array") return result;

    const identity = npcPosIdentity(pos);
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const matches = importableEntryMatchesIdentity("npcs", items[i], identity);
        for (let f = 0; f < fields.length; f++) {
            const field = fields[f];
            const refNode = json.findNodeAtLocation(items[i], [field]);
            if (!refNode || refNode.type !== "string") continue;
            const ref = String(refNode.value);
            if (matches) {
                current[field] = ref;
            } else {
                result.usedByOthers.add(ref);
            }
        }
    }

    return result;
}

export function htslTargetsForNpcExport(
    fs: ProjectFs,
    entryImportJsonPath: string,
    entry: NpcExportEntry,
    preferredNewTargetImportJson?: string,
    sectionFolderResolver: SectionFolderImportJsonResolver = sectionFolderImportJson
): NpcHtslExportTargets {
    const importJsonPath =
        readDeclaringNpcNode(fs, entryImportJsonPath, entry.pos)?.importJsonPath ??
        reachablePreferredTarget(fs, entryImportJsonPath, preferredNewTargetImportJson) ??
        sectionFolderResolver(fs, entryImportJsonPath, "npcs") ??
        entryImportJsonPath;
    const refs = readActionReferencesForNpc(
        fs,
        importJsonPath,
        entry.pos,
        ["leftClickActions", "rightClickActions"]
    );
    const usedLower = new Set<string>();
    refs.usedByOthers.forEach((name) => usedLower.add(name.toLowerCase()));
    const base = `${entry.name}_${entry.pos.x}_${entry.pos.y}_${entry.pos.z}`;

    const leftReference = pickHtslFilenameFromBase(
        refs.current.leftClickActions,
        usedLower,
        `${base}_left`,
        `NPC left-click actions for "${entry.name}"`
    );
    const rightReference = pickHtslFilenameFromBase(
        refs.current.rightClickActions,
        usedLower,
        `${base}_right`,
        `NPC right-click actions for "${entry.name}"`
    );
    const dir = fs.parentDir(importJsonPath);
    return {
        importJsonPath,
        leftClick: {
            importJsonPath,
            htslPath: fs.resolvePath(dir, leftReference),
            htslReference: leftReference,
        },
        rightClick: {
            importJsonPath,
            htslPath: fs.resolvePath(dir, rightReference),
            htslReference: rightReference,
        },
    };
}

export function sanitizeRelativeReference(raw: string): string | null {
    if (raw.length === 0) return null;
    const normalized = normalizePathSeparators(raw);
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
    itemName: string,
    subdir: string = "items",
    preferredNewTargetImportJson?: string,
    sectionFolderResolver: SectionFolderImportJsonResolver = sectionFolderImportJson
): SnbtExportTarget {
    const itemsSectionKey = fs.pathKey(
        fs.resolvePath(fs.parentDir(entryImportJsonPath), "items/import.json")
    );

    function freshTarget(baseDir: string, importJsonPath: string): SnbtExportTarget {
        // Inside the items section folder the file sits beside its
        // import.json — a `<subdir>/` there would nest items/items/.
        const effectiveSubdir =
            fs.pathKey(importJsonPath) === itemsSectionKey ? "" : subdir;
        const dir =
            effectiveSubdir.length > 0 ? fs.resolvePath(baseDir, effectiveSubdir) : baseDir;
        const filename = snbtFilenameForItemExport(fs, dir, itemName);
        return {
            importJsonPath,
            snbtPath: fs.resolvePath(dir, filename),
            snbtReference:
                effectiveSubdir.length > 0 ? `${effectiveSubdir}/${filename}` : filename,
        };
    }

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
        return freshTarget(fs.parentDir(declaring), declaring);
    }
    const preferred = reachablePreferredTarget(
        fs,
        entryImportJsonPath,
        preferredNewTargetImportJson
    );
    if (preferred !== null) {
        return freshTarget(fs.parentDir(preferred), preferred);
    }
    const sectionJson = sectionFolderResolver(fs, entryImportJsonPath, "items");
    if (sectionJson !== null) {
        return freshTarget(fs.parentDir(sectionJson), sectionJson);
    }
    return freshTarget(rootDir, entryImportJsonPath);
}
