import * as json from "jsonc-parser";
import { walkImportJsonTree } from "./includeWalk";
import {
    importableEntryMatchesIdentity,
    removeImportableEntry,
    resolveImportableFile,
    upsertImportableEntry,
    type Section,
} from "./importJsonMutations";
import { normalizePathSeparators, type ProjectFs } from "./fs";

export const ALL_SECTIONS: Section[] = ["functions", "events", "regions", "items", "menus", "teams", "groups", "commands", "npcs"];

export type MoveImportableResult =
    | { ok: true; from: string; to: string; movedFiles: Array<{ from: string; to: string }> }
    | { ok: false; message: string };

export type RefSlot = { holder: Record<string, unknown> | unknown[]; key: string | number; ref: string };

function isFileRef(value: unknown): value is string {
    return typeof value === "string" && /\.(htsl|snbt)$/i.test(value);
}

export function collectFileRefs(value: unknown, out: RefSlot[]): void {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (isFileRef(value[i])) {
                out.push({ holder: value, key: i, ref: value[i] as string });
            } else {
                collectFileRefs(value[i], out);
            }
        }
        return;
    }
    if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const key in obj) {
            const nested = obj[key];
            if (isFileRef(nested)) {
                out.push({ holder: obj, key, ref: nested });
            } else {
                collectFileRefs(nested, out);
            }
        }
    }
}

function pathWithinDir(fs: ProjectFs, dir: string, path: string): string | null {
    const dirKey = fs.pathKey(dir);
    const pathNorm = normalizePathSeparators(path);
    if (fs.pathKey(pathNorm).indexOf(`${dirKey}/`) !== 0) return null;
    return pathNorm.substring(dirKey.length + 1);
}

export function refsOfOtherEntries(
    fs: ProjectFs,
    entryJsonPath: string,
    excludeSection: Section,
    excludeIdentity: string
): Set<string> {
    const out = new Set<string>();
    walkImportJsonTree(fs, entryJsonPath, (filePath, tree) => {
        const dir = fs.parentDir(filePath);
        for (const section of ALL_SECTIONS) {
            const sectionNode = json.findNodeAtLocation(tree, [section]);
            if (!sectionNode || sectionNode.type !== "array") continue;
            const items = sectionNode.children ?? [];
            for (let i = 0; i < items.length; i++) {
                if (section === excludeSection) {
                    if (importableEntryMatchesIdentity(section, items[i], excludeIdentity)) {
                        continue;
                    }
                }
                const refs: RefSlot[] = [];
                collectFileRefs(json.getNodeValue(items[i]), refs);
                for (let j = 0; j < refs.length; j++) {
                    out.add(fs.pathKey(fs.resolvePath(dir, refs[j].ref)));
                }
            }
        }
        return undefined;
    });
    return out;
}

export function readEntryValue(
    fs: ProjectFs,
    importJsonPath: string,
    section: Section,
    identity: string
): Record<string, unknown> | null {
    if (!fs.exists(importJsonPath)) return null;
    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") return null;
    const tree = json.parseTree(text);
    if (!tree) return null;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return null;
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        if (importableEntryMatchesIdentity(section, items[i], identity)) {
            return json.getNodeValue(items[i]) as Record<string, unknown>;
        }
    }
    return null;
}

function suffixedRef(ref: string, n: number): string {
    const dot = ref.lastIndexOf(".");
    return `${ref.substring(0, dot)}_${n}${ref.substring(dot)}`;
}

export function moveImportableEntry(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string
): MoveImportableResult {
    const sourceJsonPath = resolveImportableFile(fs, entryJsonPath, section, identity);
    if (fs.pathKey(sourceJsonPath) === fs.pathKey(destJsonPath)) {
        return { ok: false, message: `'${identity}' is already declared in that file.` };
    }
    if (!fs.exists(destJsonPath)) {
        return { ok: false, message: `Destination doesn't exist: ${destJsonPath}` };
    }

    const entry = readEntryValue(fs, sourceJsonPath, section, identity);
    if (entry === null) {
        return { ok: false, message: `Couldn't find '${identity}' in ${sourceJsonPath}` };
    }

    const srcDir = fs.parentDir(sourceJsonPath);
    const destDir = fs.parentDir(destJsonPath);
    const otherRefs = refsOfOtherEntries(fs, entryJsonPath, section, identity);

    const refSlots: RefSlot[] = [];
    collectFileRefs(entry, refSlots);

    const fileOps: Array<{ from: string; to: string; deleteSource: boolean }> = [];
    for (let i = 0; i < refSlots.length; i++) {
        const slot = refSlots[i];
        const srcAbs = fs.resolvePath(srcDir, slot.ref);
        if (!fs.exists(srcAbs)) continue;
        // A file already inside the destination folder stays put; only its
        // reference shortens. Copying it would nest it one folder deeper
        // (e.g. "menus/x.htsl" moved into menus/ becoming menus/menus/x.htsl).
        const insideDest = pathWithinDir(fs, destDir, srcAbs);
        if (insideDest !== null) {
            if (insideDest !== slot.ref) {
                (slot.holder as Record<string | number, unknown>)[slot.key] = insideDest;
            }
            continue;
        }
        let ref = slot.ref;
        let destAbs = fs.resolvePath(destDir, ref);
        if (fs.pathKey(srcAbs) === fs.pathKey(destAbs)) continue;
        for (let n = 2; fs.exists(destAbs); n++) {
            ref = suffixedRef(slot.ref, n);
            destAbs = fs.resolvePath(destDir, ref);
        }
        if (ref !== slot.ref) {
            (slot.holder as Record<string | number, unknown>)[slot.key] = ref;
        }
        fileOps.push({
            from: srcAbs,
            to: destAbs,
            deleteSource: !otherRefs.has(fs.pathKey(srcAbs)),
        });
    }

    upsertImportableEntry(fs, destJsonPath, section, entry);
    if (!removeImportableEntry(fs, sourceJsonPath, section, identity)) {
        removeImportableEntry(fs, destJsonPath, section, identity);
        return { ok: false, message: `Couldn't remove '${identity}' from ${sourceJsonPath}` };
    }

    const movedFiles: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < fileOps.length; i++) {
        const op = fileOps[i];
        if (!fs.exists(op.from)) continue;
        const content = fs.readFile(op.from);
        fs.ensureDir(fs.parentDir(op.to));
        fs.writeFile(op.to, content);
        if (op.deleteSource && fs.deleteFile !== undefined) {
            try {
                fs.deleteFile(op.from);
                movedFiles.push({ from: op.from, to: op.to });
            } catch (_err) {
                // Copy succeeded; a stale original is harmless.
            }
        }
    }

    return { ok: true, from: sourceJsonPath, to: destJsonPath, movedFiles };
}
