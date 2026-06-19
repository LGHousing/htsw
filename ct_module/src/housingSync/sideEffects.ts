/// <reference types="../../CTAutocomplete" />

import type TaskContext from "../tasks/context";

const KeyBinding = Java.type("net.minecraft.client.settings.KeyBinding") as any;

/**
 * Side effects coordinating the importer with the surrounding game:
 *   - Auto-run /gmc at import start (housing edits need creative).
 *   - Play random.levelup once on success as an "import done" cue.
 *
 * Muting: overlay.ts's `soundPlay` handler suppresses GAME sounds while import
 * progress is live; it cannot cover this success cue (fired at completion, when
 * progress may already be cleared), so the caller gates the call on
 * `isImportSoundsMuted()` directly.
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

export function enableCreativeFlight(): void {
    const player = Player.getPlayer();
    const capabilities = player.field_71075_bZ;
    capabilities.field_75101_c = true;
    capabilities.field_75100_b = true;
    player.func_71016_p();
}

function isFlying(): boolean {
    return Player.getPlayer().field_71075_bZ.field_75100_b === true;
}

function getJumpKeyCode(): number | null {
    try {
        const settings = Client.getMinecraft().field_71474_y;
        const binding = settings?.field_74314_A;
        if (binding === undefined || binding === null) return null;
        try {
            return Number(binding.func_151463_i());
        } catch (_e) {
            return Number(binding.getKeyCode());
        }
    } catch (_e) {
        return null;
    }
}

async function tapJump(ctx: TaskContext, keyCode: number): Promise<void> {
    KeyBinding.func_74510_a(keyCode, true);
    KeyBinding.func_74507_a(keyCode);
    await ctx.waitFor("tick");
    KeyBinding.func_74510_a(keyCode, false);
    await ctx.waitFor("tick");
}

const FLY_TOGGLE_MAX_TICKS = 20;

export async function ensureCreativeFlight(ctx: TaskContext): Promise<boolean> {
    if (isFlying()) return true;
    if (!isInCreativeMode() && !(await waitForCreativeMode(ctx))) return false;
    const keyCode = getJumpKeyCode();
    if (keyCode === null || keyCode <= 0) return false;

    await tapJump(ctx, keyCode);
    await tapJump(ctx, keyCode);
    for (let i = 0; i < FLY_TOGGLE_MAX_TICKS; i++) {
        if (isFlying()) return true;
        await ctx.waitFor("tick");
    }
    return isFlying();
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
