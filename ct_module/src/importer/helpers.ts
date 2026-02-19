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
    await ctx.withTimeout(
        ctx.waitFor("packetReceived", (packet) => packet instanceof S30PacketWindowItems),
        "Waiting for menu to load"
    );
}

async function rawClickSlot(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT,
    waitForMenu: boolean = true
): Promise<boolean> {
    const slot = ctx.findItemSlot(name);
    if (slot === null) return false;

    const wait = waitForMenu ? waitForMenuToLoad(ctx) : Promise.resolve();
    slot.click(button);
    await wait;

    return true;
}

export async function clickSlot(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT,
    waitForMenu: boolean = true
): Promise<void> {
    const found = await rawClickSlot(ctx, name, button, waitForMenu);
    if (!found) {
        throw new Error(`Could not find slot with name '${name}'`);
    }
}

async function rawClickSlotPaginate(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT,
    waitForMenu: boolean = true
): Promise<boolean> {
    do {
        const found = await rawClickSlot(ctx, name, button, waitForMenu);
        if (found) {
            return true;
        }

        const wentToNextPage = await rawClickSlot(ctx, "Left-click for next page!");
        if (!wentToNextPage) break;
    } while (true);

    return false;
}

export async function clickSlotPaginate(
    ctx: TaskContext,
    name: string,
    button: MouseButton = MouseButton.LEFT,
    waitForMenu: boolean = true
): Promise<void> {
    const found = await rawClickSlotPaginate(ctx, name, button, waitForMenu);
    if (!found) {
        throw new Error(`Could not find slot with name '${name}'`);
    }
}

export async function goBack(
    ctx: TaskContext,
    waitForMenu: boolean = true
): Promise<void> {
    await rawClickSlot(ctx, "Go Back", MouseButton.LEFT, waitForMenu);
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
    value: string | number | boolean,
    waitForMenu: boolean = true
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

    const inputModePromise = ctx.withTimeout(
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
    await clickSlot(ctx, itemName);
    const inputMode = await inputModePromise;

    const wait = waitForMenu ? waitForMenuToLoad(ctx) : Promise.resolve();
    switch (inputMode) {
        case "CHAT":
            ctx.sendMessage(value);
            break;
        case "ANVIL":
            setAnvilItemName(value);
            acceptNewAnvilItem();
            break;
        default:
            const _exhaustiveCheck: never = inputMode;
    }
    await wait;
}
