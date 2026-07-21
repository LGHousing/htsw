import {
    collectFileRefs,
    readEntryValue,
    refsOfOtherEntries,
    type RefSlot,
} from "./moveImportable";
import { removeImportableEntry, resolveImportableFile, type Section } from "./importJsonMutations";
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
    | { ok: true; importJsonPath: string; ownedFiles: string[]; sharedFiles: string[] }
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
    if (!removeImportableEntry(fs, plan.importJsonPath, section, identity)) {
        return { ok: false, message: `Couldn't remove '${identity}' from ${plan.importJsonPath}` };
    }
    return plan;
}
