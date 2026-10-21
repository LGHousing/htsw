/// <reference types="../../CTAutocomplete" />

import { projectSectionFolders } from "htsw-editor-common/project";
import { ctProjectFs } from "./projectFs";
import { normalizeHtswPath } from "./htswPath";
import {
    asKeyedSet,
    defineRootDoc,
    serializeKeyedSet,
} from "../persistence/store";

// Which projects sort new exports into `<section>/import.json` folders. The
// folders are created on the first export of each type, so a project can want
// this layout while none of them exist on disk yet — that intent has nowhere
// to live in the project itself.

const sectionLayoutProjects = defineRootDoc<Set<string>>({
    file: "section-layout-projects.json",
    fallback: new Set<string>(),
    parse: asKeyedSet,
    serialize: serializeKeyedSet,
});

function projectKey(entryImportJsonPath: string): string {
    return normalizeHtswPath(entryImportJsonPath).toLowerCase();
}

export function isSectionLayoutProject(entryImportJsonPath: string): boolean {
    return (
        sectionLayoutProjects.get().has(projectKey(entryImportJsonPath)) ||
        projectSectionFolders(ctProjectFs, entryImportJsonPath).length > 0
    );
}

export function setSectionLayoutProject(
    entryImportJsonPath: string,
    on: boolean
): boolean {
    if (!sectionLayoutProjects.healthy()) return false;
    const key = projectKey(entryImportJsonPath);
    const current = sectionLayoutProjects.get();
    if (current.has(key) === on) return true;
    const next = new Set<string>(current);
    if (on) next.add(key);
    else next.delete(key);
    return sectionLayoutProjects.set(next);
}
