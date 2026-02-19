import { ACTION_NAMES, Action, SOUNDS } from "htsw/types";
import TaskContext from "../tasks/context";
import { MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../helpers";
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../utils/packets";

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
    // TODO idfk if we can do this without the extra tick of waiting
    await ctx.withTimeout(
        ctx.waitFor("packetReceived", (packet) => packet instanceof S30PacketWindowItems),
        "Waiting for menu to load"
    );
    await ctx.waitFor("tick", null, 10);
}

export async function waitForUnformattedMessage(
    ctx: TaskContext,
    message: string
): Promise<void> {
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) => removedFormatting(chatMessage) === message
        ),
        "Waiting for message in chat"
    );
}

function rawClickSlot(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT
): boolean {
    const slot = ctx.findItemSlot(name);
    if (slot === null) return false;
    slot.click(button);
    return true;
}

export function clickSlot(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT
) {
    const found = rawClickSlot(ctx, name, button);
    if (!found) {
        throw new Error(`Could not find slot with name '${name}'`);
    }
}

async function rawClickSlotPaginate(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT
): Promise<boolean> {
    do {
        const found = rawClickSlot(ctx, name, button);
        if (found) return true;

        const wentToNextPage = rawClickSlot(ctx, "Left-click for next page!");
        if (!wentToNextPage) break;
        await waitForMenuToLoad(ctx);
    } while (true);

    return false;
}

export async function clickSlotPaginate(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT
): Promise<void> {
    const found = await rawClickSlotPaginate(ctx, name, button);
    if (!found) {
        throw new Error(`Could not find slot with name '${name}'`);
    }
}

export function goBack(ctx: TaskContext): void {
    rawClickSlot(ctx, "Go Back");
}

export function setAnvilItemName(newName: string) {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    const outputSlotField = inventory.container.class.getDeclaredField("field_82852_f");
    // @ts-ignore
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container);

    const outputSlotItemField = outputSlot.class.getDeclaredField("field_70467_a");
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

export async function setValue(
    ctx: TaskContext,
    itemName: string,
    value: string | number | boolean
): Promise<void> {
    if (typeof value === "string") {
        value = stringAsValue(value);
    } else if (typeof value === "number") {
        value = numberAsValue(value);
    } else if (typeof value === "boolean") {
        value = booleanAsValue(value);
    } else {
        const _exhaustiveCheck: never = value;
    }

    // TODO read item lore to check for values already the same, and early return

    clickSlot(ctx, itemName);
    const inputMode = await ctx.withTimeout(
        Promise.race([
            ctx
                .waitFor("message", (message) => {
                    return removedFormatting(message).includes(
                        "Please use the chat to provide the value you wish to set."
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
        "Waiting for input mode to be determined"
    );

    switch (inputMode) {
        case "CHAT":
            ctx.sendMessage(value);
            break;
        case "ANVIL":
            await waitForMenuToLoad(ctx);
            setAnvilItemName(value);
            acceptNewAnvilItem();
            break;
        default:
            const _exhaustiveCheck: never = inputMode;
    }
}
