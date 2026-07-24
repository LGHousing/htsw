import * as json from "jsonc-parser";
import { walkImportJsonTree } from "./includeWalk";
import { addIncludeToImportJsonSource } from "./includedImportJson";
import { ALL_SECTIONS, moveImportableEntry } from "./moveImportable";
import { importableEntryIdentity, type Section } from "./importJsonMutations";
import type { ProjectFs } from "./fs";

export const SECTION_FOLDERS: Section[] = ALL_SECTIONS;

function includedFileKeys(fs: ProjectFs, entryImportJsonPath: string): Set<string> {
    const keys = new Set<string>();
    walkImportJsonTree(fs, entryImportJsonPath, (filePath) => {
        keys.add(fs.pathKey(filePath));
        return undefined;
    });
    return keys;
}

function sectionCandidatePath(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section
): string {
    return fs.resolvePath(fs.parentDir(entryImportJsonPath), `${section}/import.json`);
}

/**
 * The section's folder import.json (`<entry dir>/<section>/import.json`), but
 * only when the entry's include tree actually reaches it — a folder that
 * exists on disk without being included must not receive exports the parse
 * would never see.
 */
export function sectionFolderImportJson(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section
): string | null {
    const candidate = sectionCandidatePath(fs, entryImportJsonPath, section);
    const keys = includedFileKeys(fs, entryImportJsonPath);
    return keys.has(fs.pathKey(candidate)) ? candidate : null;
}

export function ensureSectionFolderImportJson(
    fs: ProjectFs,
    entryImportJsonPath: string,
    section: Section
): string {
    const included = sectionFolderImportJson(fs, entryImportJsonPath, section);
    if (included !== null) return included;

    const target = sectionCandidatePath(fs, entryImportJsonPath, section);
    if (!fs.exists(target)) {
        fs.ensureDir(fs.parentDir(target));
        fs.writeFile(target, "{}\n");
    }
    const source = fs.readFile(entryImportJsonPath);
    fs.writeFile(
        entryImportJsonPath,
        addIncludeToImportJsonSource(source, `${section}/import.json`)
    );
    return target;
}

export function projectSectionFolders(
    fs: ProjectFs,
    entryImportJsonPath: string
): Section[] {
    const keys = includedFileKeys(fs, entryImportJsonPath);
    return SECTION_FOLDERS.filter((section) =>
        keys.has(fs.pathKey(sectionCandidatePath(fs, entryImportJsonPath, section)))
    );
}

export type RestructureResult = {
    createdIncludes: string[];
    moved: Array<{ section: Section; identity: string }>;
    failures: Array<{ section: Section; identity: string; message: string }>;
};

function rootDeclaredIdentities(
    fs: ProjectFs,
    importJsonPath: string,
    section: Section
): string[] {
    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") return [];
    const tree = json.parseTree(text);
    if (!tree) return [];
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return [];
    const out: string[] = [];
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const identity = importableEntryIdentity(section, items[i]);
        if (identity !== null) out.push(identity);
    }
    return out;
}

/**
 * Convert a project to the per-section layout: move each importable declared in
 * the ROOT file into its `<section>/import.json`, creating and including that
 * file only for sections that have something to move. Importables the user
 * already placed in other included files are left where they are.
 */
export function restructureProjectPerSection(
    fs: ProjectFs,
    importJsonPath: string
): RestructureResult {
    if (!fs.exists(importJsonPath)) {
        throw new Error(`No import.json at ${importJsonPath}`);
    }

    const identitiesBySection = new Map<Section, string[]>();
    for (const section of SECTION_FOLDERS) {
        identitiesBySection.set(
            section,
            rootDeclaredIdentities(fs, importJsonPath, section)
        );
    }

    const createdIncludes: string[] = [];
    const moved: RestructureResult["moved"] = [];
    const failures: RestructureResult["failures"] = [];
    for (const section of SECTION_FOLDERS) {
        const identities = identitiesBySection.get(section) ?? [];
        if (identities.length === 0) continue;
        const existing = sectionFolderImportJson(fs, importJsonPath, section);
        const dest = ensureSectionFolderImportJson(fs, importJsonPath, section);
        if (existing === null) createdIncludes.push(dest);
        for (const identity of identities) {
            const result = moveImportableEntry(fs, importJsonPath, section, identity, dest);
            if (result.ok) {
                moved.push({ section, identity });
            } else {
                failures.push({ section, identity, message: result.message });
            }
        }
    }

    return { createdIncludes, moved, failures };
}
