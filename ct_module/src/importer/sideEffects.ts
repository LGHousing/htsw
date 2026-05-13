/// <reference types="../../CTAutocomplete" />

/**
 * Side effects coordinating the importer with the surrounding game:
 *
 * - Mute soundPlay events while an import is in flight (BHTSL convention;
 *   cuts the chest-open + slot-click + button-press noise spam).
 * - Auto-run `/gmc` at import start so the user lands in creative, which
 *   housing edits require.
 * - Play `random.levelup` once on successful completion as an audible
 *   "import is done" cue.
 *
 * All three are hardcoded always-on. If you want to gate them behind
 * settings later, this is the single point of change: each helper body
 * just early-returns when its toggle is off.
 */

import { getImportProgress } from "../gui/state";

/**
 * Module bootstrap: registers the global soundPlay cancel hook. Called
 * exactly once from `src/index.ts`. The handler is cheap (one null
 * check) when no import is running, so leaving it always-registered is
 * fine.
 *
 * Signature is BHTSL's verbatim — five anonymous positional args + the
 * cancellable Forge event as the 6th. Cancel is the GLOBAL `cancel()`
 * function (CT-provided, used elsewhere in this codebase via
 * `gui/overlay.ts`), NOT `event.cancel()` which is a different API
 * that does NOT actually suppress the sound in this CT build.
 */
export function registerImportSoundCancel(): void {
    register(
        "soundPlay",
        (
            _useless1: unknown,
            _useless2: unknown,
            _useless3: unknown,
            _useless4: unknown,
            _useless5: unknown,
            // ForgePlaySoundEvent is what CTAutocomplete advertises as
            // the cancellable Forge event for this trigger. Other handlers
            // in this codebase (gui/overlay.ts, lib/panel.ts) cancel the
            // same way.
            event: any
        ) => {
            if (getImportProgress() === null) return;
            cancel(event);
        }
    );
}

/**
 * Fire right before `TaskManager.run` kicks off the import task — but
 * AFTER any empty-queue early-returns, so we don't switch the user's
 * gamemode for a no-op invocation.
 */
export function gmcOnImportStart(): void {
    // Second arg `true` = silent: don't echo the typed command back to chat.
    ChatLib.command("gmc", true);
}

/**
 * Fire after `TaskManager.run`'s try/finally has cleared the import
 * progress flag — otherwise the soundPlay cancel hook above would
 * swallow this sound too.
 */
export function playImportSuccessSound(): void {
    World.playSound("random.levelup", 2, 1);
}
