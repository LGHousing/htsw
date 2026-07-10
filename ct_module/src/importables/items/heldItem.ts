import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { closeOpenScreen } from "../../housingSync/sideEffects";
import {
    HOTBAR_ZERO_PACKET_SLOT,
    SET_SLOT_ACK_MAX_TICKS,
    selectHotbarSlot,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
} from "../../housingSync/menus/packets";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { COST } from "../../housingSync/progress/costs";
import { timed } from "../../housingSync/progress/timing";

function hotbarSlotStack(slot: number): any | null {
    const current = Player.getInventory()?.getStackInSlot(slot);
    if (current === null || current === undefined) return null;
    return current.getItemStack();
}

// The server echoes an accepted creative set-slot back with slightly
// rewritten NBT (observed: identical name/damage/count, tag text one char
// longer), so exact areItemStacksEqual never recognizes a landed injection.
// Item, damage, count, and display name survive the round-trip and are
// enough to identify the stack we just sent to this specific slot.
function stackLanded(current: any, sent: any): boolean {
    return (
        current.func_77973_b() === sent.func_77973_b() &&
        current.func_77960_j() === sent.func_77960_j() &&
        current.field_77994_a === sent.field_77994_a &&
        String(current.func_82833_r()) === String(sent.func_82833_r())
    );
}

function hotbarZeroLanded(stack: any): boolean {
    const current = hotbarSlotStack(0);
    return current !== null && stackLanded(current, stack);
}

async function switchToHotbarSlot(ctx: TaskContext, slot: number): Promise<void> {
    if (selectedHotbarSlot() === slot) return;
    selectHotbarSlot(ctx, slot);
    // The held-slot change only reaches the server on the next client tick, when
    // vanilla flushes C09PacketHeldItemChange. Yield a tick so a following /edit
    // (or creative spawn) acts on the newly held item, not the previous one —
    // otherwise the import can run against the wrong slot. See issue #57.
    await ctx.waitFor("tick");
}

async function clearHotbarZero(ctx: TaskContext): Promise<void> {
    if (hotbarSlotStack(0) === null) return;
    sendCreativeInventoryAction(ctx, HOTBAR_ZERO_PACKET_SLOT, null);
    const cleared = await pollTicks(
        ctx,
        SET_SLOT_ACK_MAX_TICKS,
        () => hotbarSlotStack(0) === null
    );
    if (!cleared) {
        const observed = summarizeItemStack(hotbarSlotStack(0));
        throw new Error(
            `could not clear hotbar slot 0 before item injection ` +
                `(slot 0 holds: ${JSON.stringify(observed)}).`
        );
    }
}

export type HeldItemSlotSnapshot = {
    selectedSlot: number;
    stack: any | null;
};

export function snapshotHeldItemInjectionSlot(): HeldItemSlotSnapshot {
    return { selectedSlot: selectedHotbarSlot(), stack: hotbarSlotStack(0) };
}

export async function injectHeldItem(ctx: TaskContext, item: Item): Promise<void> {
    const stack = item.getItemStack();
    if (stack === null || stack === undefined) {
        throw new Error("Cannot inject an empty item stack.");
    }

    await closeOpenScreen(ctx);
    await clearHotbarZero(ctx);

    sendCreativeInventoryAction(
        ctx,
        HOTBAR_ZERO_PACKET_SLOT,
        stack,
    );
    const landed = await pollTicks(ctx, SET_SLOT_ACK_MAX_TICKS, () => hotbarZeroLanded(stack));
    if (!landed) {
        const observed = summarizeItemStack(hotbarSlotStack(0));
        throw new Error(
            `Hypixel did not accept this item into your hotbar. Check that its SNBT is formatted correctly ` +
                `(slot 0 holds: ${observed === null ? "nothing" : JSON.stringify(observed)}).`
        );
    }
    await ctx.waitFor("tick");

    await switchToHotbarSlot(ctx, 0);
    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));
}

export async function restoreHeldItemInjectionSlot(
    ctx: TaskContext,
    snapshot: HeldItemSlotSnapshot
): Promise<void> {
    await closeOpenScreen(ctx);
    sendCreativeInventoryAction(ctx, HOTBAR_ZERO_PACKET_SLOT, snapshot.stack);
    await ctx.waitFor("tick");
    await switchToHotbarSlot(ctx, snapshot.selectedSlot);
}
