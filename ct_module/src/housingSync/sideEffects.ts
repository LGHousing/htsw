/// <reference types="../../CTAutocomplete" />

import type TaskContext from "../tasks/context";

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

export function isInCreativeMode(): boolean {
    // field_71075_bZ = PlayerCapabilities, field_75098_d = isCreativeMode.
    // This is the flag the server checks before honouring a creative-inventory
    // spawn, so it's the one that tells us a spawn will actually land.
    return Player.getPlayer().field_71075_bZ.field_75098_d === true;
}

const GMC_APPLY_MAX_TICKS = 60;

/**
 * Block until /gmc has actually taken effect. The command is sent at import
 * start but creative mode only flips after a server round-trip; creative spawns
 * issued before then are silently dropped, so the first item would fail to
 * appear. Resolves true once creative is active, or false if it never applied
 * within ~3s (caller surfaces the likely cause).
 */
export async function waitForCreativeMode(ctx: TaskContext): Promise<boolean> {
    for (let i = 0; i < GMC_APPLY_MAX_TICKS; i++) {
        if (isInCreativeMode()) return true;
        await ctx.waitFor("tick");
    }
    return isInCreativeMode();
}

export function playImportSuccessSound(): void {
    World.playSound("random.levelup", 2, 1);
}
