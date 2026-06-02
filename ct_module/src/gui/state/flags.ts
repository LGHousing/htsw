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
 */
let muteImportSounds = false;
export function isImportSoundsMuted(): boolean {
    return muteImportSounds;
}
export function setImportSoundsMuted(muted: boolean): void {
    muteImportSounds = muted;
}
