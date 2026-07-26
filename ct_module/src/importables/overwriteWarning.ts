import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../persistence/settingsFiles";

export type OverwriteWarningMode = "always" | "trusted" | "off";

const DEFAULT_MODE: OverwriteWarningMode = "always";
const FILE_NAME = "overwrite-warning.json";
let loaded = false;
let mode: OverwriteWarningMode = DEFAULT_MODE;

function isMode(value: unknown): value is OverwriteWarningMode {
    return value === "always" || value === "trusted" || value === "off";
}

function load(): void {
    if (loaded) return;
    const stored = readJsonSettingsFile(FILE_NAME);
    mode = stored.ok && stored.found && isMode(stored.value)
        ? stored.value
        : DEFAULT_MODE;
    loaded = true;
}

export function getOverwriteWarningMode(): OverwriteWarningMode {
    load();
    return mode;
}

export function setOverwriteWarningMode(value: OverwriteWarningMode): boolean {
    load();
    if (mode === value) return true;
    const previous = mode;
    mode = value;
    if (writeJsonSettingsFile(FILE_NAME, mode)) return true;
    mode = previous;
    return false;
}

export function overwriteWarningsEnabled(
    value: OverwriteWarningMode,
    trustedImport: boolean
): boolean {
    return value === "always" || (value === "trusted" && trustedImport);
}
