/// <reference types="../../CTAutocomplete" />

import { atomicWriteText } from "../utils/filesystem";
import { runtimeString, type RuntimeString } from "../utils/java";

const SETTINGS_ROOT = "./htsw/.settings";
const LEGACY_ROOTS = ["./htsw/.state", "./htsw/.cache"];

export function settingsFilePath(fileName: string): string {
    return `${SETTINGS_ROOT}/${fileName}`;
}

/**
 * Every path a document may have lived at before, newest first.
 *
 * Two kinds feed in here. `LEGACY_ROOTS` are earlier spellings of the
 * settings directory itself, so they keep the same basename. `extraLegacy`
 * are explicit full paths with their own basenames — used to lift the
 * `gui-*.json` family out of `./config/ChatTriggers/modules/HTSW`, which the
 * auto-updater rewrites and a reinstall wipes.
 */
function legacyPathsFor(fileName: string, extraLegacy: readonly string[]): string[] {
    const paths: string[] = [];
    for (let i = 0; i < LEGACY_ROOTS.length; i++) {
        paths.push(`${LEGACY_ROOTS[i]}/${fileName}`);
    }
    for (let i = 0; i < extraLegacy.length; i++) paths.push(extraLegacy[i]);
    return paths;
}

function removeLegacyFiles(fileName: string, extraLegacy: readonly string[]): void {
    const paths = legacyPathsFor(fileName, extraLegacy);
    for (let i = 0; i < paths.length; i++) {
        try {
            if (FileLib.exists(paths[i])) FileLib.delete(paths[i]);
        } catch (_e) {}
    }
}

export function readSettingsFile(
    fileName: string,
    extraLegacy: readonly string[] = []
): string | null {
    const path = settingsFilePath(fileName);
    if (FileLib.exists(path)) {
        const value = FileLib.read(path) as RuntimeString | null | undefined;
        if (value === null || value === undefined) {
            throw new Error(`Could not read settings file: ${path}`);
        }
        const raw = runtimeString(value);
        removeLegacyFiles(fileName, extraLegacy);
        return raw;
    }

    const legacyPaths = legacyPathsFor(fileName, extraLegacy);
    for (let i = 0; i < legacyPaths.length; i++) {
        const legacyPath = legacyPaths[i];
        if (!FileLib.exists(legacyPath)) continue;
        const value = FileLib.read(legacyPath) as RuntimeString | null | undefined;
        if (value === null || value === undefined) {
            throw new Error(`Could not read settings file: ${legacyPath}`);
        }
        const raw = runtimeString(value);
        if (atomicWriteText(path, raw)) removeLegacyFiles(fileName, extraLegacy);
        return raw;
    }
    return null;
}

export type JsonSettingsRead =
    | { ok: true; found: false }
    | { ok: true; found: true; value: unknown }
    | { ok: false };

export function readJsonSettingsFile(
    fileName: string,
    extraLegacy: readonly string[] = []
): JsonSettingsRead {
    try {
        const raw = readSettingsFile(fileName, extraLegacy);
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
