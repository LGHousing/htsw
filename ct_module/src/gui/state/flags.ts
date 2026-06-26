import { getMuteImportSounds, setMuteImportSounds } from "../../settings";

let parseInProgress = false;
export function isParseInProgress(): boolean {
    return parseInProgress;
}
export function setParseInProgress(v: boolean): void {
    parseInProgress = v;
}

/**
 * When true, sound effects fired by `Forge.PlaySoundEvent` are cancelled
 * while an import is in flight. Suppresses the repetitive ding/click
 * sounds Hypixel plays on every housing menu open during an import.
 * Persisted via the settings store so the choice survives /ct reload.
 */
export function isImportSoundsMuted(): boolean {
    return getMuteImportSounds();
}
export function setImportSoundsMuted(muted: boolean): void {
    setMuteImportSounds(muted);
}
