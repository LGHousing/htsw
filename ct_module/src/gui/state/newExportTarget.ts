/// <reference types="../../../CTAutocomplete" />

import { getExportImportJsonPath } from "./paths";
import { normalizeHtswPath } from "../lib/pathDisplay";
import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../../persistence/settingsFiles";

// Saved separately for each project. It only chooses the file for brand-new
// entries; existing entries stay in the file that already declares them.

const EXPORT_TARGETS_FILE_NAME = "export-targets.json";
let loaded = false;
const targetByBase: Map<string, string> = new Map();

function baseKey(basePath: string): string {
    return normalizeHtswPath(basePath).toLowerCase();
}

function loadTargets(): boolean {
    if (loaded) return true;
    const stored = readJsonSettingsFile(EXPORT_TARGETS_FILE_NAME);
    if (!stored.ok) return false;
    const value = stored.found ? stored.value : {};
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i++) {
        if (typeof rec[keys[i]] !== "string") return false;
    }
    targetByBase.clear();
    for (let i = 0; i < keys.length; i++) {
        targetByBase.set(keys[i], rec[keys[i]] as string);
    }
    loaded = true;
    return true;
}

function saveTargets(): boolean {
    const obj: Record<string, string> = {};
    targetByBase.forEach((value, key) => {
        obj[key] = value;
    });
    return writeJsonSettingsFile(EXPORT_TARGETS_FILE_NAME, obj);
}

/** The saved file for brand-new entries in this project, if the user chose one. */
export function getNewExportTarget(): string | null {
    loadTargets();
    const base = getExportImportJsonPath();
    if (base.trim() === "") return null;
    return targetByBase.get(baseKey(base)) ?? null;
}

/** The sub-target for display/selection: the explicit choice, else the base. */
export function getEffectiveNewExportTarget(): string {
    const explicit = getNewExportTarget();
    return explicit !== null ? explicit : getExportImportJsonPath();
}

export function setNewExportTarget(path: string): boolean {
    if (!loadTargets()) return false;
    const base = getExportImportJsonPath();
    if (base.trim() === "") return false;
    const key = baseKey(base);
    const normalized = normalizeHtswPath(path);
    const previous = targetByBase.get(key);
    if (previous === normalized) return true;
    targetByBase.set(key, normalized);
    if (saveTargets()) return true;
    if (previous === undefined) targetByBase.delete(key);
    else targetByBase.set(key, previous);
    return false;
}
