/// <reference types="../../CTAutocomplete" />

import { projectSectionFolders } from "htsw-editor-common/project";
import { ctProjectFs } from "./projectFs";
import { normalizeHtswPath } from "./htswPath";
import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../persistence/settingsFiles";

// Which projects sort new exports into `<section>/import.json` folders. The
// folders are created on the first export of each type, so a project can want
// this layout while none of them exist on disk yet — that intent has nowhere
// to live in the project itself.

const SECTION_LAYOUT_PROJECTS_FILE_NAME = "section-layout-projects.json";
let loaded = false;
const sectionLayoutProjects: Set<string> = new Set();

function projectKey(entryImportJsonPath: string): string {
    return normalizeHtswPath(entryImportJsonPath).toLowerCase();
}

function loadProjects(): boolean {
    if (loaded) return true;
    const stored = readJsonSettingsFile(SECTION_LAYOUT_PROJECTS_FILE_NAME);
    if (!stored.ok) return false;
    const value = stored.found ? stored.value : {};
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i++) {
        if (record[keys[i]] !== true) return false;
    }
    sectionLayoutProjects.clear();
    for (let i = 0; i < keys.length; i++) sectionLayoutProjects.add(keys[i]);
    loaded = true;
    return true;
}

function saveProjects(): boolean {
    const value: Record<string, true> = {};
    sectionLayoutProjects.forEach((key) => {
        value[key] = true;
    });
    return writeJsonSettingsFile(SECTION_LAYOUT_PROJECTS_FILE_NAME, value);
}

export function isSectionLayoutProject(entryImportJsonPath: string): boolean {
    loadProjects();
    return (
        sectionLayoutProjects.has(projectKey(entryImportJsonPath)) ||
        projectSectionFolders(ctProjectFs, entryImportJsonPath).length > 0
    );
}

export function setSectionLayoutProject(
    entryImportJsonPath: string,
    on: boolean
): boolean {
    if (!loadProjects()) return false;
    const key = projectKey(entryImportJsonPath);
    const previous = sectionLayoutProjects.has(key);
    if (previous === on) return true;
    if (on) sectionLayoutProjects.add(key);
    else sectionLayoutProjects.delete(key);
    if (saveProjects()) return true;
    if (previous) sectionLayoutProjects.add(key);
    else sectionLayoutProjects.delete(key);
    return false;
}
