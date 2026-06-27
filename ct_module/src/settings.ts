/// <reference types="../CTAutocomplete" />

// Persisted user preferences. One JSON file for all of them so adding a
// setting is a new field, not a new file with its own load/persist pair.
const SETTINGS_PATH = "./config/ChatTriggers/modules/HTSW/gui-settings.json";

export type AutoUpdatePreference = "unset" | "enabled" | "disabled";

type Settings = {
    muteImportSounds: boolean;
    autoProceed: boolean;
    smoothScrolling: boolean;
    autoUpdate: AutoUpdatePreference;
};

let state: Settings = {
    muteImportSounds: false,
    autoProceed: true,
    smoothScrolling: true,
    autoUpdate: "unset",
};
let loaded = false;

function parseAutoUpdatePreference(value: unknown): AutoUpdatePreference {
    return value === "enabled" || value === "disabled" ? value : "unset";
}

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(SETTINGS_PATH)) return;
        const raw = String(FileLib.read(SETTINGS_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw) as Partial<Settings>;
        state = {
            muteImportSounds: parsed.muteImportSounds === true,
            autoProceed: parsed.autoProceed !== false,
            smoothScrolling: parsed.smoothScrolling !== false,
            autoUpdate: parseAutoUpdatePreference(parsed.autoUpdate),
        };
    } catch (_e) {
        // fresh defaults on a bad file
    }
}

function persist(): void {
    try {
        FileLib.write(SETTINGS_PATH, JSON.stringify(state, null, 2), true);
    } catch (_e) {
        // best-effort
    }
}

export function getMuteImportSounds(): boolean {
    load();
    return state.muteImportSounds;
}

export function setMuteImportSounds(value: boolean): void {
    load();
    state.muteImportSounds = value;
    persist();
}

export function getAutoProceedSetting(): boolean {
    load();
    return state.autoProceed;
}

export function setAutoProceedSetting(value: boolean): void {
    load();
    state.autoProceed = value;
    persist();
}

export function getSmoothScrolling(): boolean {
    load();
    return state.smoothScrolling;
}

export function setSmoothScrolling(value: boolean): void {
    load();
    state.smoothScrolling = value;
    persist();
}

export function getAutoUpdatePreference(): AutoUpdatePreference {
    load();
    return state.autoUpdate;
}

export function setAutoUpdatePreference(value: AutoUpdatePreference): void {
    load();
    state.autoUpdate = value;
    persist();
}
