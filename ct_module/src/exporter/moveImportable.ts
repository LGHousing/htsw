import * as json from "jsonc-parser";

import { FileSystemFileLoader } from "../utils/fileLoaders";
import { ensureParentDirs } from "../utils/filesystem";
import { walkImportJsonTree } from "./includeWalk";
import {
    identityField,
    removeImportableEntry,
    resolveImportableFile,
    upsertImportableEntry,
    type Section,
} from "./importJsonWriter";
import { parentDirOf } from "./paths";

/**
 * Move one importable's declaration to another import.json in the same
 * include tree. Every file reference on the entry (`actions`, `nbt`, menu
 * slot paths, …) is relative to its declaring file, so the referenced
 * .htsl/.snbt files move along with it — except files other entries still
 * reference, which are copied so the remaining references keep resolving.
 */

const ALL_SECTIONS: Section[] = ["functions", "events", "regions", "items", "menus", "npcs"];

export type MoveImportableResult =
    | { ok: true; from: string; to: string; movedFiles: Array<{ from: string; to: string }> }
    | { ok: false; message: string };

type RefSlot = { holder: Record<string, unknown> | unknown[]; key: string | number; ref: string };

function isFileRef(v: unknown): v is string {
    return typeof v === "string" && /\.(htsl|snbt)$/i.test(v);
}

function collectFileRefs(value: unknown, out: RefSlot[]): void {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (isFileRef(value[i])) out.push({ holder: value, key: i, ref: value[i] as string });
            else collectFileRefs(value[i], out);
        }
        return;
    }
    if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const k in obj) {
            const v = obj[k];
            if (isFileRef(v)) out.push({ holder: obj, key: k, ref: v });
            else collectFileRefs(v, out);
        }
    }
}

function canonKey(p: string): string {
    return p.split("\\").join("/").toLowerCase();
}

/**
 * Resolved paths of every file referenced by entries OTHER than the one
 * being moved, across the whole include tree. A moved entry's file is only
 * physically moved when nothing in here still points at it.
 */
function refsOfOtherEntries(
    loader: FileSystemFileLoader,
    entryJsonPath: string,
    excludeSection: Section,
    excludeIdField: string,
    excludeIdentity: string
): Set<string> {
    const out = new Set<string>();
    walkImportJsonTree(entryJsonPath, (filePath, tree) => {
        const dir = parentDirOf(filePath);
        for (const section of ALL_SECTIONS) {
            const sectionNode = json.findNodeAtLocation(tree, [section]);
            if (!sectionNode || sectionNode.type !== "array") continue;
            const items = sectionNode.children ?? [];
            for (let i = 0; i < items.length; i++) {
                if (section === excludeSection) {
                    const idNode = json.findNodeAtLocation(items[i], [excludeIdField]);
                    if (idNode && idNode.type === "string" && idNode.value === excludeIdentity) {
                        continue;
                    }
                }
                const refs: RefSlot[] = [];
                collectFileRefs(json.getNodeValue(items[i]), refs);
                for (let j = 0; j < refs.length; j++) {
                    out.add(canonKey(loader.resolvePath(dir, refs[j].ref)));
                }
            }
        }
        return undefined;
    });
    return out;
}

function readEntryValue(
    importJsonPath: string,
    section: Section,
    idField: string,
    identity: string
): Record<string, unknown> | null {
    if (!FileLib.exists(importJsonPath)) return null;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return null;
    const tree = json.parseTree(text);
    if (!tree) return null;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return null;
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const idNode = json.findNodeAtLocation(items[i], [idField]);
        if (idNode && idNode.type === "string" && idNode.value === identity) {
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
    entryJsonPath: string,
    section: Section,
    identity: string,
    destJsonPath: string
): MoveImportableResult {
    const loader = new FileSystemFileLoader();
    const idField = identityField(section);
    const sourceJsonPath = resolveImportableFile(entryJsonPath, section, identity);
    if (canonKey(sourceJsonPath) === canonKey(destJsonPath)) {
        return { ok: false, message: `'${identity}' is already declared in that file.` };
    }
    if (!FileLib.exists(destJsonPath)) {
        return { ok: false, message: `Destination doesn't exist: ${destJsonPath}` };
    }

    const entry = readEntryValue(sourceJsonPath, section, idField, identity);
    if (entry === null) {
        return { ok: false, message: `Couldn't find '${identity}' in ${sourceJsonPath}` };
    }

    const srcDir = parentDirOf(sourceJsonPath);
    const destDir = parentDirOf(destJsonPath);
    const otherRefs = refsOfOtherEntries(loader, entryJsonPath, section, idField, identity);

    const refSlots: RefSlot[] = [];
    collectFileRefs(entry, refSlots);

    const fileOps: Array<{ from: string; to: string; deleteSource: boolean }> = [];
    for (let i = 0; i < refSlots.length; i++) {
        const slot = refSlots[i];
        const srcAbs = loader.resolvePath(srcDir, slot.ref);
        if (!FileLib.exists(srcAbs)) continue; // broken before, equally broken after
        let ref = slot.ref;
        let destAbs = loader.resolvePath(destDir, ref);
        if (canonKey(srcAbs) === canonKey(destAbs)) continue; // both dirs see the same file
        for (let n = 2; FileLib.exists(destAbs); n++) {
            ref = suffixedRef(slot.ref, n);
            destAbs = loader.resolvePath(destDir, ref);
        }
        if (ref !== slot.ref) {
            (slot.holder as Record<string | number, unknown>)[slot.key] = ref;
        }
        fileOps.push({
            from: srcAbs,
            to: destAbs,
            deleteSource: !otherRefs.has(canonKey(srcAbs)),
        });
    }

    upsertImportableEntry(destJsonPath, section, entry);
    if (!removeImportableEntry(sourceJsonPath, section, identity)) {
        // Roll the insert back rather than leaving a duplicate declaration,
        // which would fail the whole parse.
        removeImportableEntry(destJsonPath, section, identity);
        return { ok: false, message: `Couldn't remove '${identity}' from ${sourceJsonPath}` };
    }

    const movedFiles: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < fileOps.length; i++) {
        const op = fileOps[i];
        const content = FileLib.read(op.from);
        if (content === null) continue;
        ensureParentDirs(op.to);
        FileLib.write(op.to, String(content), true);
        if (op.deleteSource) {
            try {
                FileLib.delete(op.from);
                movedFiles.push({ from: op.from, to: op.to });
            } catch (_e) {
                // Copy succeeded; a stale original is harmless.
            }
        }
    }

    return { ok: true, from: sourceJsonPath, to: destJsonPath, movedFiles };
}
