import * as json from "jsonc-parser";
import {
    collectFileRefs,
    readEntryValue,
    refsOfOtherEntries,
    type RefSlot,
} from "./moveImportable";
import { removeImportableEntry, resolveImportableFile, type Section } from "./importJsonMutations";
import { removeIncludeFromImportJson } from "./includedImportJson";
import { walkImportJsonTree } from "./includeWalk";
import type { ProjectFs } from "./fs";

export type DeleteImportablePlan =
    | {
          ok: true;
          importJsonPath: string;
          ownedFiles: string[];
          sharedFiles: string[];
      }
    | { ok: false; message: string };

export type DeleteImportableResult =
    | {
          ok: true;
          importJsonPath: string;
          ownedFiles: string[];
          sharedFiles: string[];
          prunedImportJsonFiles: string[];
      }
    | { ok: false; message: string };

export function planDeleteImportableEntry(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string,
): DeleteImportablePlan {
    const importJsonPath = resolveImportableFile(fs, entryJsonPath, section, identity);
    const entry = readEntryValue(fs, importJsonPath, section, identity);
    if (entry === null) {
        return { ok: false, message: `Couldn't find '${identity}' in ${importJsonPath}` };
    }

    const dir = fs.parentDir(importJsonPath);
    const otherRefs = refsOfOtherEntries(fs, entryJsonPath, section, identity);
    const refSlots: RefSlot[] = [];
    collectFileRefs(entry, refSlots);

    const owned = new Map<string, string>();
    const shared = new Map<string, string>();
    for (let i = 0; i < refSlots.length; i++) {
        const filePath = fs.resolvePath(dir, refSlots[i].ref);
        if (!fs.exists(filePath)) continue;
        const key = fs.pathKey(filePath);
        if (otherRefs.has(key)) {
            shared.set(key, filePath);
        } else {
            owned.set(key, filePath);
        }
    }

    return {
        ok: true,
        importJsonPath,
        ownedFiles: Array.from(owned.values()),
        sharedFiles: Array.from(shared.values()),
    };
}

export function removeImportableEntryForDelete(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string,
): DeleteImportableResult {
    const plan = planDeleteImportableEntry(fs, entryJsonPath, section, identity);
    if (!plan.ok) return plan;
    const includeParents = collectIncludeParents(fs, entryJsonPath);
    if (!removeImportableEntry(fs, plan.importJsonPath, section, identity)) {
        return { ok: false, message: `Couldn't remove '${identity}' from ${plan.importJsonPath}` };
    }
    return {
        ...plan,
        prunedImportJsonFiles: pruneEmptyIncludedImportJsonFiles(
            fs,
            entryJsonPath,
            plan.importJsonPath,
            includeParents
        ),
    };
}

function collectIncludeParents(fs: ProjectFs, entryJsonPath: string): Map<string, string[]> {
    const parents = new Map<string, string[]>();
    walkImportJsonTree(fs, entryJsonPath, (parentPath, tree) => {
        const includeNode = json.findNodeAtLocation(tree, ["include"]);
        if (!includeNode || includeNode.type !== "array") return undefined;
        const children = includeNode.children ?? [];
        for (let i = 0; i < children.length; i++) {
            if (children[i].type !== "string") continue;
            const childPath = fs.resolvePath(
                fs.parentDir(parentPath),
                String(children[i].value)
            );
            const key = fs.pathKey(childPath);
            const existing = parents.get(key);
            if (existing === undefined) parents.set(key, [parentPath]);
            else if (!existing.some((path) => fs.pathKey(path) === fs.pathKey(parentPath))) {
                existing.push(parentPath);
            }
        }
        return undefined;
    });
    return parents;
}

function pruneEmptyIncludedImportJsonFiles(
    fs: ProjectFs,
    entryJsonPath: string,
    declaringImportJsonPath: string,
    includeParents: Map<string, string[]>
): string[] {
    if (fs.deleteFile === undefined) return [];

    const rootKey = fs.pathKey(entryJsonPath);
    const pending = [declaringImportJsonPath];
    const visited = new Set<string>();
    const pruned: string[] = [];
    while (pending.length > 0) {
        const importJsonPath = pending.shift()!;
        const key = fs.pathKey(importJsonPath);
        if (key === rootKey || visited.has(key)) continue;
        visited.add(key);
        if (!fs.exists(importJsonPath) || !isEmptyImportJson(fs.readFile(importJsonPath))) continue;

        const parents = includeParents.get(key) ?? [];
        if (parents.length === 0) continue;
        let detached = true;
        for (let i = 0; i < parents.length; i++) {
            const parentPath = parents[i];
            if (!fs.exists(parentPath)) continue;
            if (!removeAllIncludes(fs, parentPath, importJsonPath)) {
                detached = false;
                break;
            }
        }
        if (!detached) continue;

        fs.deleteFile(importJsonPath);
        pruned.push(importJsonPath);
        for (let i = 0; i < parents.length; i++) pending.push(parents[i]);
    }
    return pruned;
}

function removeAllIncludes(
    fs: ProjectFs,
    parentImportJsonPath: string,
    includedImportJsonPath: string
): boolean {
    let removed = false;
    while (removeIncludeFromImportJson(fs, parentImportJsonPath, includedImportJsonPath)) {
        removed = true;
    }
    return removed;
}

function isEmptyImportJson(source: string): boolean {
    if (json.stripComments(source) !== source) return false;
    const value = json.parse(source) as unknown;
    return isEmptyContainer(value);
}

function isEmptyContainer(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 0;
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    return keys.every((key) => isEmptyContainer(record[key]));
}
