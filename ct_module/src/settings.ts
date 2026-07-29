/// <reference types="../CTAutocomplete" />

import { runtimeString, type RuntimeString } from "./utils/java";

// Persisted user preferences. One JSON file for all of them so adding a
// setting is a new field, not a new file with its own load/persist pair.
const SETTINGS_PATH = "./config/ChatTriggers/modules/HTSW/gui-settings.json";

export type AutoUpdatePreference = "unset" | "enabled" | "disabled";

type Settings = {
    showInventoryButtons: boolean;
    showChatPanel: boolean;
    muteTaskSounds: boolean;
    playImportCompletionSound: boolean;
    smoothScrolling: boolean;
    watchMode: boolean;
    uploadSlowParseDiagnostics: boolean;
    uploadSessionHeartbeat: boolean;
    autoUpdate: AutoUpdatePreference;
};

let state: Settings = {
    showInventoryButtons: true,
    showChatPanel: true,
    muteTaskSounds: false,
    playImportCompletionSound: true,
    smoothScrolling: true,
    watchMode: false,
    uploadSlowParseDiagnostics: true,
    uploadSessionHeartbeat: true,
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
        const stored = FileLib.read(SETTINGS_PATH) as RuntimeString | null | undefined;
        const raw = runtimeString(stored);
        if (raw.trim() === "") return;
        const decoded: unknown = JSON.parse(raw);
        if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
            return;
        }
        const parsed = decoded as Record<string, unknown>;
        const legacySoundsMuted = parsed.muteImportSounds === true;
        state = {
            showInventoryButtons: parsed.showInventoryButtons !== false,
            showChatPanel: parsed.showChatPanel !== false,
            muteTaskSounds:
                parsed.muteTaskSounds === undefined
                    ? legacySoundsMuted
                    : parsed.muteTaskSounds === true,
            playImportCompletionSound:
                parsed.playImportCompletionSound === undefined
                    ? !legacySoundsMuted
                    : parsed.playImportCompletionSound !== false,
            smoothScrolling: parsed.smoothScrolling !== false,
            watchMode: parsed.watchMode === true,
            uploadSlowParseDiagnostics:
                parsed.uploadSlowParseDiagnostics !== false,
            uploadSessionHeartbeat: parsed.uploadSessionHeartbeat !== false,
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

export function getShowInventoryButtons(): boolean {
    load();
    return state.showInventoryButtons;
}

export function setShowInventoryButtons(value: boolean): void {
    load();
    state.showInventoryButtons = value;
    persist();
}

export function getShowChatPanel(): boolean {
    load();
    return state.showChatPanel;
}

export function setShowChatPanel(value: boolean): void {
    load();
    state.showChatPanel = value;
    persist();
}

export function getMuteTaskSounds(): boolean {
    load();
    return state.muteTaskSounds;
}

export function setMuteTaskSounds(value: boolean): void {
    load();
    state.muteTaskSounds = value;
    persist();
}

export function getPlayImportCompletionSound(): boolean {
    load();
    return state.playImportCompletionSound;
}

export function setPlayImportCompletionSound(value: boolean): void {
    load();
    state.playImportCompletionSound = value;
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

export function getWatchMode(): boolean {
    load();
    return state.watchMode;
}

export function setWatchMode(value: boolean): void {
    load();
    state.watchMode = value;
    persist();
}

export function getUploadSlowParseDiagnostics(): boolean {
    load();
    return state.uploadSlowParseDiagnostics;
}

export function getUploadSessionHeartbeat(): boolean {
    load();
    return state.uploadSessionHeartbeat;
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
