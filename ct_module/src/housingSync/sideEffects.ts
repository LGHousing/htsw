/// <reference types="../../CTAutocomplete" />

/**
 * Side effects coordinating the importer with the surrounding game:
 *   - Auto-run /gmc at import start (housing edits need creative).
 *   - Play random.levelup once on success as an "import done" cue.
 *
 * Sound muting lives in overlay.ts's `soundPlay` handler, which gates on the
 * `isImportSoundsMuted()` toggle. Don't add a second handler here — it would
 * cancel unconditionally and make the toggle a no-op.
 */

export function gmcOnImportStart(): void {
    ChatLib.command("gmc", true);
}

export function playImportSuccessSound(): void {
    World.playSound("random.levelup", 2, 1);
}
