/// <reference types="../../../CTAutocomplete" />

import { getExportImportJsonPath } from "./paths";
import { normalizeHtswPath } from "../lib/pathDisplay";

// The sticky "new exports land here" file, chosen per export destination. It is
// keyed by the base destination (the parse root the include tree walks from),
// so switching destinations recalls that destination's own choice. Only new
// importables honor it — the routing in exportTargets keeps re-exports on their
// existing declaration and ignores a target the include tree no longer reaches.

const EXPORT_TARGETS_FILE = "./htsw/.cache/export-targets.json";
let loaded = false;
const targetByBase: Map<string, string> = new Map();

function baseKey(basePath: string): string {
    return normalizeHtswPath(basePath).toLowerCase();
}

function loadTargets(): void {
    if (loaded) return;
    try {
        if (FileLib.exists(EXPORT_TARGETS_FILE)) {
            const raw = String(FileLib.read(EXPORT_TARGETS_FILE) ?? "");
            if (raw.trim() !== "") {
                const obj = JSON.parse(raw) as unknown;
                if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
                    const rec = obj as Record<string, unknown>;
                    const keys = Object.keys(rec);
                    for (let i = 0; i < keys.length; i++) {
                        const value = rec[keys[i]];
                        if (typeof value === "string") targetByBase.set(keys[i], value);
                    }
                }
            }
        }
        // Only mark loaded once a read actually succeeded (a missing file is a
        // legitimately empty map). A transient failure leaves this false so a
        // later call retries rather than persisting a partial map over disk.
        loaded = true;
    } catch (_e) {}
}

function saveTargets(): void {
    try {
        const obj: Record<string, string> = {};
        targetByBase.forEach((value, key) => {
            obj[key] = value;
        });
        FileLib.write(EXPORT_TARGETS_FILE, JSON.stringify(obj), true);
    } catch (_e) {}
}

/**
 * The explicit sub-target chosen for the current destination, or null when the
 * user hasn't picked one (routing then uses its default declared/section-folder/
 * base fallback). Pass this to export tasks as `newExportTargetImportJson`.
 */
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

export function setNewExportTarget(path: string): void {
    loadTargets();
    const base = getExportImportJsonPath();
    if (base.trim() === "") return;
    targetByBase.set(baseKey(base), normalizeHtswPath(path));
    saveTargets();
}
