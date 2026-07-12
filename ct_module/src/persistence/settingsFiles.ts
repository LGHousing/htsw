/// <reference types="../../CTAutocomplete" />

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
        const raw = String(FileLib.read(path) ?? "");
        removeLegacyFiles(fileName);
        return raw;
    }

    for (let i = 0; i < LEGACY_ROOTS.length; i++) {
        const legacyPath = `${LEGACY_ROOTS[i]}/${fileName}`;
        if (!FileLib.exists(legacyPath)) continue;
        const raw = String(FileLib.read(legacyPath) ?? "");
        try {
            FileLib.write(path, raw, true);
            removeLegacyFiles(fileName);
        } catch (_e) {}
        return raw;
    }
    return null;
}
