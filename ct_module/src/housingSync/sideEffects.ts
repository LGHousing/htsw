/// <reference types="../../CTAutocomplete" />

import type TaskContext from "../tasks/context";
import { pollTicks } from "../tasks/poll";
import { getMinecraft, getPlayer, javaType } from "../utils/java";

const KeyBinding = javaType("net.minecraft.client.settings.KeyBinding");

/**
 * Side effects coordinating the importer with the surrounding game:
 *   - Auto-run /gmc at import start (housing edits need creative).
 *   - Play random.levelup once on success as an "import done" cue.
 *
 * The completion cue is fired after task progress clears, so its preference is
 * checked directly by the caller instead of the in-task sound interceptor.
 */

export function gmcOnImportStart(): void {
    ChatLib.command("gmc");
}

export function isInCreativeMode(): boolean {
    // field_71075_bZ = PlayerCapabilities, field_75098_d = isCreativeMode.
    // This is the flag the server checks before honouring a creative-inventory
    // spawn, so it's the one that tells us a spawn will actually land.
    return getPlayer().field_71075_bZ.field_75098_d;
}

function isFlying(): boolean {
    return getPlayer().field_71075_bZ.field_75100_b;
}

function getJumpKeyCode(): number | null {
    try {
        const settings = getMinecraft().field_71474_y;
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
const FLY_TAP_ATTEMPTS = 2;

function currentScreenIsOpen(): boolean {
    return getMinecraft().field_71462_r !== null;
}

// Jump taps go through client keybindings, which never fire while a screen is
// open. Held-slot changes are also only ever sent by the vanilla client with
// no screen open, so close before those too. Creative set-slot packets are NOT
// affected — measured 2026-07-31: spawns land fine with Housing chest menus
// open (Housing Menu, Functions list, Regions list).
export async function closeOpenScreen(ctx: TaskContext): Promise<void> {
    if (!currentScreenIsOpen()) return;
    // func_71053_j = EntityPlayer.closeScreen — same as pressing Esc on a
    // container, including notifying the server.
    getPlayer().func_71053_j();
    await ctx.waitFor("tick");
}

export async function ensureCreativeFlight(ctx: TaskContext): Promise<boolean> {
    if (isFlying()) return true;
    if (!isInCreativeMode() && !(await waitForCreativeMode(ctx))) return false;

    const keyCode = getJumpKeyCode();
    if (keyCode === null || keyCode <= 0) return false;

    for (let attempt = 0; attempt < FLY_TAP_ATTEMPTS; attempt++) {
        await closeOpenScreen(ctx);
        await tapJump(ctx, keyCode);
        await tapJump(ctx, keyCode);
        if (await pollTicks(ctx, FLY_TOGGLE_MAX_TICKS, isFlying)) return true;
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
    return pollTicks(ctx, GMC_APPLY_MAX_TICKS, isInCreativeMode);
}

export function playImportSuccessSound(): void {
    World.playSound("random.levelup", 2, 1);
}
