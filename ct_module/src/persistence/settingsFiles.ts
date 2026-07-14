/// <reference types="../../CTAutocomplete" />

import { atomicWriteText } from "../utils/filesystem";

const SETTINGS_ROOT = "./htsw/.settings";
const LEGACY_ROOTS = ["./htsw/.state", "./htsw/.cache"];

export function settingsFilePath(fileName: string): string {
    return `${SETTINGS_ROOT}/${fileName}`;
}

function removeLegacyFiles(fileName: string): void {
    for (let i = 0; i < LEGACY_ROOTS.length; i++) {
        const path = `${LEGACY_ROOTS[i]}/${fileName}`;
        try {
            if (FileLib.exists(path)) FileLib.delete(path);
        } catch (_e) {}
    }
}

export function readSettingsFile(fileName: string): string | null {
    const path = settingsFilePath(fileName);
    if (FileLib.exists(path)) {
        const value = FileLib.read(path);
        if (value === null || value === undefined) {
            throw new Error(`Could not read settings file: ${path}`);
        }
        const raw = String(value);
        removeLegacyFiles(fileName);
        return raw;
    }

    for (let i = 0; i < LEGACY_ROOTS.length; i++) {
        const legacyPath = `${LEGACY_ROOTS[i]}/${fileName}`;
        if (!FileLib.exists(legacyPath)) continue;
        const value = FileLib.read(legacyPath);
        if (value === null || value === undefined) {
            throw new Error(`Could not read settings file: ${legacyPath}`);
        }
        const raw = String(value);
        if (atomicWriteText(path, raw)) removeLegacyFiles(fileName);
        return raw;
    }
    return null;
}

export type JsonSettingsRead =
    | { ok: true; found: false }
    | { ok: true; found: true; value: unknown }
    | { ok: false };

export function readJsonSettingsFile(fileName: string): JsonSettingsRead {
    try {
        const raw = readSettingsFile(fileName);
        if (raw === null || raw.trim() === "") return { ok: true, found: false };
        return { ok: true, found: true, value: JSON.parse(raw) as unknown };
    } catch (_e) {
        return { ok: false };
    }
}

export function writeJsonSettingsFile(
    fileName: string,
    value: unknown,
    pretty = false
): boolean {
    try {
        const serialized = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
        return atomicWriteText(settingsFilePath(fileName), serialized);
    } catch (_e) {
        return false;
    }
}
