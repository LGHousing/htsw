import { ACTION_NAMES, Action, SOUNDS } from "htsw/types";
import TaskContext from "../tasks/context";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../tasks/specifics/waitFor";

function stringAsValue(value: string): string {
    return value;
}

function numberAsValue(value: number): string {
    return value.toString();
}

function booleanAsValue(value: boolean): string {
    return value ? "Enabled" : "Disabled";
}

// TODO export this if needed, else remove
function soundPathToName(path: string): string | null {
    for (const sound of SOUNDS) {
        if (sound.path === path) return sound.name;
    }
    return null;
}

export async function waitForMenuToLoad(ctx: TaskContext): Promise<void> {
    await ctx.withTimeout(async () => {
        await ctx.waitFor("packetReceived", (packet) => {
            if (!(packet instanceof S30PacketWindowItems)) return false;
            const windowID = packet.func_148911_c();
            return (
                windowID !== 0 &&
                windowID !==
                    lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero
            );
        });

        // Netty handles packets from a worker thread but the packet is only
        // actually handled by Minecraft once it is synchronized with the main
        // thread. So we have to wait for the next tick so the packet will be
        // processed and the window items will be in the container.
        await ctx.waitFor("tick");
    }, "Waiting for menu to load");
}

export async function waitForUnformattedMessage(
    ctx: TaskContext,
    message: string,
): Promise<void> {
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) => removedFormatting(chatMessage) === message,
        ),
        "Waiting for message in chat",
    );
}

export async function getSlotPaginate(
    ctx: TaskContext,
    name: string,
): Promise<ItemSlot> {
    do {
        const slot = ctx.tryGetItemSlot(name);
        if (slot !== null) return slot;

        const nextPageSlot = ctx.tryGetItemSlot("Left-click for next page!");
        if (nextPageSlot === null) break;
        nextPageSlot.click();
        await waitForMenuToLoad(ctx);
    } while (true);

    throw new Error(`Could not find "${name}" on any page.`);
}

export function clickGoBack(ctx: TaskContext): void {
    ctx.getItemSlot("Go Back").click();
}

export function setAnvilItemName(newName: string) {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    const outputSlotField =
        inventory.container.class.getDeclaredField("field_82852_f");
    // @ts-ignore
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container);

    const outputSlotItemField =
        outputSlot.class.getDeclaredField("field_70467_a");
    outputSlotItemField.setAccessible(true);
    let outputSlotItem = outputSlotItemField.get(outputSlot);

    outputSlotItem[0] = new Item(339).setName(newName).itemStack;
    outputSlotItemField.set(outputSlot, outputSlotItem);
}

export function acceptNewAnvilItem(): void {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    inventory.click(2, false);
}

function readCurrentValue(slot: ItemSlot): string | null {
    const lore = slot.getItem().getLore();
    const index = lore.findIndex(
        (line, i) => removedFormatting(line) === "Current Value:",
    );
    if (index === -1) return null;

    if (index + 1 >= lore.length) {
        return null;
    }
    return lore[index + 1];
}

export async function setValue(
    ctx: TaskContext,
    itemName: string,
    value: string | number | boolean,
): Promise<void> {
    let formattedValue: string;
    if (typeof value === "string") {
        formattedValue = stringAsValue(value);
    } else if (typeof value === "number") {
        formattedValue = numberAsValue(value);
    } else if (typeof value === "boolean") {
        formattedValue = booleanAsValue(value);
    } else {
        const _exhaustiveCheck: never = value;
        formattedValue = _exhaustiveCheck;
    }

    // TODO check item lore to see if already set yuh

    const slot = ctx.getItemSlot(itemName);
    slot.click();
    if (typeof value === "boolean") {
        return;
    }

    const inputMode = await ctx.withTimeout(
        Promise.race([
            ctx
                .waitFor("message", (message) => {
                    return removedFormatting(message).includes(
                        "Please use the chat to provide the value you wish to set.",
                    );
                })
                .then(() => "CHAT" as const),
            ctx
                .waitFor("packetReceived", (packet) => {
                    return (
                        packet instanceof S2DPacketOpenWindow &&
                        packet
                            .func_148902_e
                            /*getGuiId*/
                            () === "minecraft:anvil"
                    );
                })
                .then(() => "ANVIL" as const),
        ]),
        "Waiting for input mode to be determined",
    );

    switch (inputMode) {
        case "CHAT":
            ctx.sendMessage(formattedValue);
            break;
        case "ANVIL":
            await waitForMenuToLoad(ctx);
            setAnvilItemName(formattedValue);
            acceptNewAnvilItem();
            break;
        default:
            const _exhaustiveCheck: never = inputMode;
    }
}
