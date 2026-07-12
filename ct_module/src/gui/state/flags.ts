import {
    getMuteTaskSounds,
    getPlayImportCompletionSound,
    setMuteTaskSounds,
    setPlayImportCompletionSound,
} from "../../settings";

let parseInProgress = false;
export function isParseInProgress(): boolean {
    return parseInProgress;
}
export function setParseInProgress(v: boolean): void {
    parseInProgress = v;
}

/**
 * When true, sound effects fired by `Forge.PlaySoundEvent` are cancelled
 * while a Housing sync task is in flight. Suppresses the repetitive sounds
 * Hypixel plays while its menus are being driven.
 * Persisted via the settings store so the choice survives /ct reload.
 */
export function areTaskSoundsMuted(): boolean {
    return getMuteTaskSounds();
}
export function setTaskSoundsMuted(muted: boolean): void {
    setMuteTaskSounds(muted);
}
export function isImportCompletionSoundEnabled(): boolean {
    return getPlayImportCompletionSound();
}
export function setImportCompletionSoundEnabled(enabled: boolean): void {
    setPlayImportCompletionSound(enabled);
}
