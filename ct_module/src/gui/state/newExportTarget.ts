/// <reference types="../../../CTAutocomplete" />

import { getExportImportJsonPath } from "./paths";
import { normalizeHtswPath } from "../lib/pathDisplay";
import {
    asStringMapValue,
    defineRootDoc,
    serializeStringMap,
} from "../../persistence/store";

// Saved separately for each project. It only chooses the file for brand-new
// entries; existing entries stay in the file that already declares them.

const targetByBase = defineRootDoc<Map<string, string>>({
    file: "export-targets.json",
    fallback: new Map<string, string>(),
    parse: asStringMapValue,
    serialize: serializeStringMap,
});

function baseKey(basePath: string): string {
    return normalizeHtswPath(basePath).toLowerCase();
}

/** The saved file for brand-new entries in this project, if the user chose one. */
export function getNewExportTarget(): string | null {
    const base = getExportImportJsonPath();
    if (base.trim() === "") return null;
    return targetByBase.get().get(baseKey(base)) ?? null;
}

/** The sub-target for display/selection: the explicit choice, else the base. */
export function getEffectiveNewExportTarget(): string {
    const explicit = getNewExportTarget();
    return explicit !== null ? explicit : getExportImportJsonPath();
}

export function setNewExportTarget(path: string): boolean {
    if (!targetByBase.healthy()) return false;
    const base = getExportImportJsonPath();
    if (base.trim() === "") return false;
    const key = baseKey(base);
    const normalized = normalizeHtswPath(path);
    const current = targetByBase.get();
    if (current.get(key) === normalized) return true;
    const next = new Map<string, string>(current);
    next.set(key, normalized);
    return targetByBase.set(next);
}
