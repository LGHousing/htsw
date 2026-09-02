/// <reference types="../CTAutocomplete" />

import {
    asBoolean,
    asEnum,
    defineDoc,
    defineValue,
    type ValueParser,
} from "./persistence/store";

// Persisted user preferences. One document for all of them so adding a
// setting is a new declaration, not a new file with its own load/persist pair.
//
// Lives under `./htsw/.settings/` rather than the module directory it used to
// occupy: the module directory is the artifact the auto-updater rewrites and a
// reinstall wipes, which is no place to keep the user's preferences.

export type AutoUpdatePreference = "unset" | "enabled" | "disabled";
export type UploadDiagnosticsPreference = "unset" | "enabled" | "disabled";

const LEGACY_SETTINGS_PATH = "./config/ChatTriggers/modules/HTSW/gui-settings.json";

const SETTINGS = defineDoc({
    file: "settings.json",
    legacyPaths: [LEGACY_SETTINGS_PATH],
    // A hand-mangled preferences file should reset to defaults rather than
    // latch every toggle off with no way for the user to recover in-game.
    onReadError: "defaults",
    pretty: true,
    migrate(data) {
        // `muteImportSounds` split into a mute toggle and a completion-chime
        // toggle. Only fold when the newer keys are absent, so a user who has
        // since set them explicitly keeps their choice.
        if (Object.prototype.hasOwnProperty.call(data, "muteImportSounds")) {
            const legacyMuted = data.muteImportSounds === true;
            if (data.muteTaskSounds === undefined) data.muteTaskSounds = legacyMuted;
            if (data.playImportCompletionSound === undefined) {
                data.playImportCompletionSound = !legacyMuted;
            }
            delete data.muteImportSounds;
        }

        // Watch mode became queue-wide Auto-run. Preserve the old toggle once,
        // but never let it override an explicit value written by a newer build.
        if (data.autoRun === undefined && typeof data.watchMode === "boolean") {
            data.autoRun = data.watchMode;
        }
        delete data.watchMode;
    },
});

const parseUploadDiagnostics: ValueParser<UploadDiagnosticsPreference> = (
    raw,
    fallback
) => {
    if (raw === "enabled" || raw === "disabled") return raw;
    // Predates the tri-state: a bare `true` meant opted in.
    return raw === true ? "enabled" : fallback;
};

const showInventoryButtons = defineValue(SETTINGS, {
    key: "showInventoryButtons",
    fallback: true,
    parse: asBoolean,
});
const showChatPanel = defineValue(SETTINGS, {
    key: "showChatPanel",
    fallback: true,
    parse: asBoolean,
});
const muteTaskSounds = defineValue(SETTINGS, {
    key: "muteTaskSounds",
    fallback: false,
    parse: asBoolean,
});
const playImportCompletionSound = defineValue(SETTINGS, {
    key: "playImportCompletionSound",
    fallback: true,
    parse: asBoolean,
});
const smoothScrolling = defineValue(SETTINGS, {
    key: "smoothScrolling",
    fallback: true,
    parse: asBoolean,
});
const unmatchedFunctionsFirst = defineValue(SETTINGS, {
    key: "unmatchedFunctionsFirst",
    fallback: false,
    parse: asBoolean,
});
const autoRun = defineValue(SETTINGS, {
    key: "autoRun",
    fallback: false,
    parse: asBoolean,
});
const restoreWorkspace = defineValue(SETTINGS, {
    key: "restoreWorkspace",
    fallback: true,
    parse: asBoolean,
});
const uploadDiagnostics = defineValue<UploadDiagnosticsPreference>(SETTINGS, {
    key: "uploadDiagnostics",
    fallback: "unset",
    parse: parseUploadDiagnostics,
});
const autoUpdate = defineValue<AutoUpdatePreference>(SETTINGS, {
    key: "autoUpdate",
    fallback: "unset",
    parse: asEnum(["enabled", "disabled"] as const) as ValueParser<AutoUpdatePreference>,
});

export function getShowInventoryButtons(): boolean {
    return showInventoryButtons.get();
}
export function setShowInventoryButtons(value: boolean): void {
    showInventoryButtons.set(value);
}

export function getShowChatPanel(): boolean {
    return showChatPanel.get();
}
export function setShowChatPanel(value: boolean): void {
    showChatPanel.set(value);
}

export function getMuteTaskSounds(): boolean {
    return muteTaskSounds.get();
}
export function setMuteTaskSounds(value: boolean): void {
    muteTaskSounds.set(value);
}

export function getPlayImportCompletionSound(): boolean {
    return playImportCompletionSound.get();
}
export function setPlayImportCompletionSound(value: boolean): void {
    playImportCompletionSound.set(value);
}

export function getSmoothScrolling(): boolean {
    return smoothScrolling.get();
}
export function setSmoothScrolling(value: boolean): void {
    smoothScrolling.set(value);
}

export function getUnmatchedFunctionsFirst(): boolean {
    return unmatchedFunctionsFirst.get();
}
export function setUnmatchedFunctionsFirst(value: boolean): void {
    unmatchedFunctionsFirst.set(value);
}

export function getAutoRun(): boolean {
    return autoRun.get();
}
export function setAutoRun(value: boolean): void {
    autoRun.set(value);
}

/** Whether the projects list, tabs and queue come back after a reload. */
export function getRestoreWorkspace(): boolean {
    return restoreWorkspace.get();
}
export function setRestoreWorkspace(value: boolean): void {
    restoreWorkspace.set(value);
}

export function getUploadDiagnostics(): boolean {
    return uploadDiagnostics.get() === "enabled";
}

export function getUploadDiagnosticsPreference(): UploadDiagnosticsPreference {
    return uploadDiagnostics.get();
}

export function setUploadDiagnostics(value: boolean): void {
    uploadDiagnostics.set(value ? "enabled" : "disabled");
}

export function getAutoUpdatePreference(): AutoUpdatePreference {
    return autoUpdate.get();
}

export function setAutoUpdatePreference(value: AutoUpdatePreference): void {
    autoUpdate.set(value);
}
