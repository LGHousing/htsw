import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { removedFormatting } from "../../utils/helpers";
import { recordRuntimeDebug } from "../../runtimeDebug/runtimeDebugBuffer";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { canonicalItemKey } from "../itemCapture";
import { timedWaitForMenu, waitForMenu } from "../menus/menuWait";
import { SET_SLOT_ACK_MAX_TICKS, sendCreativeInventoryAction } from "../menus/packets";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";
import { isUnspawnableItem } from "htsw";

const INV_PACKET_SLOT = 26; // inventory row 2, column 9 (for HasItem and similar, rightmost, out of the way — matches BHTSL)

/**
 * Compares two NMS ItemStacks for the purpose of finding/placing the item a
 * field should hold. Defaults to `canonicalStacksEqual`; the icon path passes
 * a looser item+count comparator.
 */
export type StackMatcher = (a: MCItemStack, b: MCItemStack) => boolean;

// The server rewrites item NBT on any round-trip (integral tags re-typed, blank
// lore lines become "§7"), so byte-exact areItemStacksEqual never matches a
// server-side stack against a source-built one. Compare through canonicalItemKey,
// the shared key defined in fields/itemTagCanonical.ts.
function canonicalStacksEqual(left: MCItemStack, right: MCItemStack): boolean {
    return canonicalItemKey(new Item(left)) === canonicalItemKey(new Item(right));
}

function containerItemAt(slotId: number): Item | null | undefined {
    const container = Player.getContainer() as unknown as
        | ReturnType<typeof Player.getContainer>
        | null
        | undefined;
    if (container === null || container === undefined) return undefined;
    const items = container.getItems() as unknown as Array<Item | null | undefined>;
    return slotId >= 0 && slotId < items.length ? items[slotId] : undefined;
}

function slotMatchesStack(
    slotId: number,
    stack: MCItemStack,
    match: StackMatcher
): boolean {
    const slot = containerItemAt(slotId);
    return slot !== null && slot !== undefined && match(slot.getItemStack(), stack);
}

function containerSlotStack(slotId: number): MCItemStack | null {
    const slot = containerItemAt(slotId);
    if (slot === null || slot === undefined) return null;
    return slot.getItemStack();
}

/**
 * Set the value of a Housing "Item" field (GIVE_ITEM, REMOVE_ITEM, IS_ITEM, ...).
 *
 * Strategy:
 * 1. Click the field to open the item-selection submenu (shows player inventory)
 * 2. Scan the player inventory area for a matching item (via ItemStack equality)
 * 3. If found, click it directly — no injection needed
 * 4. If not found, inject into slot 26 via creative packet, wait for ack, click
 *
 * Uses slot 26 (row 2, col 9) to avoid clobbering hotbar items (matches BHTSL).
 */
export async function setItemValue(
    ctx: TaskContext,
    fieldName: string,
    item: Item,
    match: StackMatcher = canonicalStacksEqual
): Promise<void> {
    ctx.getItemSlot(fieldName).click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await selectItemFromOpenInventory(ctx, item, fieldName, match);
}

/**
 * Select `item` from the player-inventory area of the currently open
 * item-selection menu. If the item is not already visible in inventory,
 * inject it into a scratch inventory slot first, then click it.
 */
export async function selectItemFromOpenInventory(
    ctx: TaskContext,
    item: Item,
    label: string,
    match: StackMatcher = canonicalStacksEqual
): Promise<void> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error(
            `No open container for "${label}" item selection — cannot inject item.`
        );
    }

    const playerInvStart = container.getSize() - 36;
    // The 9th hotbar slot (the container's last slot) can't be clicked into an
    // item field — the click doesn't register — so don't match against it; fall
    // through to a scratch-slot injection instead. See issue #58.
    const ninthHotbarSlot = container.getSize() - 1;
    const desiredStack = item.getItemStack();
    const desiredSummary = summarizeItemStack(desiredStack);
    recordRuntimeDebug("itemInjection", {
        stage: "selectStart",
        label,
        desired: desiredSummary,
        containerSize: container.getSize(),
    });

    const existingSlot = ctx.tryGetItemSlot((s) => {
        if (s.getSlotId() < playerInvStart) return false;
        if (s.getSlotId() === ninthHotbarSlot) return false;
        const slotStack = s.getItem().getItemStack();
        return match(slotStack, desiredStack);
    });

    if (existingSlot !== null) {
        recordRuntimeDebug("itemInjection", {
            stage: "existingSlotMatched",
            label,
            slot: existingSlot.getSlotId(),
            stack: summarizeItemStack(existingSlot.getItem().getItemStack()),
        });
        existingSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    const targetSlotInContainer = container.getSize() - 36 + (INV_PACKET_SLOT - 9);
    const scratchSlot = ctx.tryGetItemSlot(
        (s) => s.getSlotId() === targetSlotInContainer
    );
    if (
        scratchSlot !== null &&
        match(scratchSlot.getItem().getItemStack(), desiredStack)
    ) {
        recordRuntimeDebug("itemInjection", {
            stage: "scratchSlotMatched",
            label,
            slot: targetSlotInContainer,
            stack: summarizeItemStack(scratchSlot.getItem().getItemStack()),
        });
        scratchSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    if (
        desiredSummary !== null &&
        desiredSummary.id !== null &&
        isUnspawnableItem(desiredSummary.id)
    ) {
        throw new Error(`Cannot creative-spawn "${desiredSummary.id}" for "${label}".`);
    }

    recordRuntimeDebug("itemInjection", {
        stage: "creativeSend",
        label,
        packetSlot: INV_PACKET_SLOT,
        targetSlot: targetSlotInContainer,
        desired: desiredSummary,
        before: summarizeItemStack(containerSlotStack(targetSlotInContainer)),
    });
    sendCreativeInventoryAction(ctx, INV_PACKET_SLOT, desiredStack);
    const landed = await pollTicks(ctx, SET_SLOT_ACK_MAX_TICKS, () =>
        slotMatchesStack(targetSlotInContainer, desiredStack, match)
    );
    if (!landed) {
        const itemName = removedFormatting(item.getName());
        const observed = summarizeItemStack(containerSlotStack(targetSlotInContainer));
        recordRuntimeDebug("itemInjection", {
            stage: "creativeFailed",
            label,
            packetSlot: INV_PACKET_SLOT,
            targetSlot: targetSlotInContainer,
            desired: desiredSummary,
            observed,
        });
        const observedText =
            observed === null
                ? "the target slot was empty"
                : `the target slot held "${observed.cleanName}" (${observed.id ?? "unknown id"}:${observed.damage ?? "?"})`;
        throw new Error(
            `Couldn't place "${itemName}" for "${label}" — ${observedText} after ` +
                `creative spawn instead of the expected item/NBT.`
        );
    }
    recordRuntimeDebug("itemInjection", {
        stage: "creativeMatched",
        label,
        packetSlot: INV_PACKET_SLOT,
        targetSlot: targetSlotInContainer,
        observed: summarizeItemStack(containerSlotStack(targetSlotInContainer)),
    });
    await ctx.waitFor("tick");

    const slot = ctx.tryGetItemSlot((s) => s.getSlotId() === targetSlotInContainer);
    if (slot === null) {
        throw new Error(
            `Could not find injected item for "${label}" selection at container slot ${targetSlotInContainer}.`
        );
    }

    slot.click();
    await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
}
