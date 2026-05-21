/// <reference types="../../CTAutocomplete" />

/**
 * Side effects coordinating the importer with the surrounding game:
 *   - Mute soundPlay events while an import is in flight.
 *   - Auto-run /gmc at import start (housing edits need creative).
 *   - Play random.levelup once on success as an "import done" cue.
 */

import { isImportRunning } from "./runtimeState";

export function registerImportSoundCancel(): void {
    register(
        "soundPlay",
        (
            _useless1: unknown,
            _useless2: unknown,
            _useless3: unknown,
            _useless4: unknown,
            _useless5: unknown,
            // Cancel via the GLOBAL `cancel()` (CT-provided) — `event.cancel()`
            // does not suppress the sound in this CT build.
            event: any
        ) => {
            if (!isImportRunning()) return;
            cancel(event);
        }
    );
}

export function gmcOnImportStart(): void {
    ChatLib.command("gmc", true);
}

export function playImportSuccessSound(): void {
    World.playSound("random.levelup", 2, 1);
}
