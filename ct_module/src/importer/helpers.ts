import TaskContext from "../tasks/context";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../tasks/specifics/waitFor";
import {
    normalizeLoreValueFormatting,
    normalizeNoteText,
    parseLoreKeyValueLine,
    readListItemNote,
} from "./loreParsing";

export async function waitForMenu(ctx: TaskContext): Promise<void> {
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
    await goToFirstPaginatedOptionPage(ctx);

    for (let page = 0; page < 100; page++) {
        const slot = ctx.tryGetItemSlot(name);
        if (slot !== null) return slot;

        const nextPageSlot = findPaginationControl(ctx, "next");
        if (nextPageSlot === null) break;
        nextPageSlot.click();
        await waitForMenu(ctx);
    }

    throw new Error(`Could not find "${name}" on any page.`);
}

async function goToFirstPaginatedOptionPage(ctx: TaskContext): Promise<void> {
    for (let page = 0; page < 100; page++) {
        const prevPageSlot = findPaginationControl(ctx, "previous");
        if (prevPageSlot === null) return;
        prevPageSlot.click();
        await waitForMenu(ctx);
    }

    throw new Error("Could not find the first page of this paginated menu.");
}

function findPaginationControl(
    ctx: TaskContext,
    direction: "next" | "previous",
): ItemSlot | null {
    const exactText = `Left-click for ${direction} page!`;
    const exactSlot = ctx.tryGetItemSlot(exactText);
    if (exactSlot !== null) return exactSlot;

    const needle = `${direction} page`;
    return ctx.tryGetItemSlot((slot) => {
        const item = slot.getItem();
        const lines = [item.getName(), ...item.getLore()];
        return lines.some((line) =>
            removedFormatting(line).trim().toLowerCase().includes(needle),
        );
    });
}

export async function clickGoBack(ctx: TaskContext): Promise<void> {
    ctx.getItemSlot("Go Back").click();
    await waitForMenu(ctx);
}

export async function openSubmenu(ctx: TaskContext, slotName: string): Promise<void> {
    ctx.getItemSlot(slotName).click();
    await waitForMenu(ctx);
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

export async function setListItemNote(
    ctx: TaskContext,
    slot: ItemSlot,
    note: string | undefined,
): Promise<void> {
    const normalizedNote =
        note === undefined ? undefined : normalizeNoteText(note);
    const currentNote = readListItemNote(slot);
    if (currentNote === undefined && normalizedNote === undefined) {
        return;
    }

    if (
        currentNote !== undefined &&
        normalizedNote !== undefined &&
        normalizeNoteText(currentNote) === normalizedNote
    ) {
        return;
    }

    slot.drop();
    if (normalizedNote === undefined) {
        await waitForChatInputPrompt(ctx);
        ctx.runCommand("/chatinput cancel");
    } else {
        await enterValue(ctx, normalizedNote);
    }
    await waitForMenu(ctx);
}

export function readCurrentValue(slot: ItemSlot): string | null {
    const lines = readCurrentValueLines(slot);
    if (lines === null) {
        return null;
    }

    return lines[0] ?? null;
}

function readCurrentValueLines(slot: ItemSlot): string[] | null {
    const lore = slot.getItem().getLore();
    const index = lore.findIndex(
        (line, _i) => removedFormatting(line) === "Current Value:",
    );
    if (index === -1) return null;

    if (index + 1 >= lore.length) {
        return null;
    }

    const lines: string[] = [];
    for (let i = index + 1; i < lore.length; i++) {
        const rawLine = lore[i];
        const line = removedFormatting(rawLine).trim();

        if (line === "") break;
        if (line.startsWith("minecraft:") || line.startsWith("NBT:")) break;
        if (
            line === "Left Click to edit!" ||
            line === "Right Click to remove!" ||
            line === "Click to edit!" ||
            line.startsWith("Use shift ") ||
            line.startsWith("LSHIFT ") ||
            line.startsWith("SHIFT ")
        ) {
            break;
        }

        lines.push(rawLine);
    }

    return lines.length === 0 ? null : lines;
}

export function normalizeSelectedOption(line: string): string {
    return removedFormatting(line)
        .trim()
        .replace(/^[^A-Za-z0-9]+/, "")
        .trim();
}

export function readSelectedOption(
    slot: ItemSlot,
    options: readonly string[],
): string | null {
    const optionSet = new Set(options);

    for (const line of slot.getItem().getLore()) {
        const trimmedLine = removedFormatting(line).trim();
        const option = normalizeSelectedOption(line);
        const hasSelectionMarker = trimmedLine !== option;
        if (hasSelectionMarker && optionSet.has(option)) {
            return option;
        }
    }

    return null;
}

export function readBooleanValue(slot: ItemSlot): boolean | null {
    const currentValue = readCurrentValue(slot);
    if (currentValue === null) {
        return null;
    }

    const normalized = removedFormatting(currentValue).trim();
    if (normalized === "Enabled") {
        return true;
    }
    if (normalized === "Disabled") {
        return false;
    }
    return null;
}

export function readStringValue(slot: ItemSlot): string | null {
    const currentValueLines = readCurrentValueLines(slot);
    if (currentValueLines === null) {
        return null;
    }

    return currentValueLines
        .map((line) => stripLeadingFormattingCodes(normalizeLoreValueFormatting(line)).trim())
        .join(" ");
}

function stripLeadingFormattingCodes(value: string): string {
    return value.replace(/^(?:&[0-9a-fklmnor])+/i, "");
}

export function findMenuOptionByLore(
    ctx: TaskContext,
    loreLine: string,
): ItemSlot | null {
    return ctx.tryGetItemSlot((slot) =>
        slot
            .getItem()
            .getLore()
            .some((line) => removedFormatting(line).trim() === loreLine),
    );
}

function isAlreadySelectedOption(slot: ItemSlot): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) =>
            removedFormatting(line)
                .trim()
                .toLowerCase()
                .includes("already selected"),
        );
}

export async function setBooleanValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: boolean,
) {
    const newValue = value ? "Enabled" : "Disabled";
    const currentValue = readCurrentValue(slot);
    if (currentValue !== null && removedFormatting(currentValue) === newValue) {
        return;
    }

    slot.click();
    await waitForMenu(ctx);
}

export async function setSelectValue(
    ctx: TaskContext,
    slotName: string,
    value: string,
): Promise<void> {
    await openSubmenu(ctx, slotName);

    const optionSlot = await getSlotPaginate(ctx, value);
    if (isAlreadySelectedOption(optionSlot)) {
        await clickGoBack(ctx);
        return;
    }

    optionSlot.click();
    await waitForMenu(ctx);

    if (ctx.tryGetItemSlot(slotName) !== null) {
        return;
    }

    await clickGoBack(ctx);
}

export async function setCycleValue(
    ctx: TaskContext,
    slotName: string,
    options: readonly string[],
    value: string,
): Promise<void> {
    if (options.indexOf(value) === -1) {
        throw new Error(`"${value}" is not a valid option for "${slotName}".`);
    }

    const getSlot = () => ctx.getItemSlot(slotName);
    const currentValue = readSelectedOption(getSlot(), options);

    if (currentValue === value) {
        return;
    }

    async function clickUntilMatch(
        button: MouseButton,
        maxClicks: number,
    ): Promise<boolean> {
        for (let i = 0; i < maxClicks; i++) {
            getSlot().click(button);
            await waitForMenu(ctx);

            if (readSelectedOption(getSlot(), options) === value) {
                return true;
            }
        }

        return false;
    }

    if (currentValue !== null) {
        const currentIndex = options.indexOf(currentValue);
        const targetIndex = options.indexOf(value);
        const leftClicks =
            (targetIndex - currentIndex + options.length) % options.length;
        const rightClicks =
            (currentIndex - targetIndex + options.length) % options.length;
        const preferredButton =
            rightClicks < leftClicks ? MouseButton.RIGHT : MouseButton.LEFT;
        const preferredClicks = Math.min(leftClicks, rightClicks);

        if (await clickUntilMatch(preferredButton, preferredClicks)) {
            return;
        }
    }

    if (await clickUntilMatch(MouseButton.LEFT, options.length)) {
        return;
    }

    throw new Error(`Could not set "${slotName}" to "${value}".`);
}

export async function enterValue(ctx: TaskContext, value: string) {
    const inputMode = await ctx.withTimeout(
        Promise.race([
            waitForChatInputPrompt(ctx).then(() => "CHAT" as const),
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
            ctx.sendMessage(value);
            break;
        case "ANVIL":
            await waitForMenu(ctx);
            setAnvilItemName(value);
            acceptNewAnvilItem();
            break;
        default:
            const _exhaustiveCheck: never = inputMode;
    }
}

function waitForChatInputPrompt(ctx: TaskContext): Promise<unknown> {
    return ctx.waitFor("message", (message) => {
        return removedFormatting(message).includes(
            "Please use the chat to provide the value you wish to set.",
        );
    });
}

export async function setNumberValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: number,
) {
    const newValue = value.toString();
    const currentValue = readCurrentValue(slot);
    if (
        currentValue !== null &&
        removedFormatting(currentValue).trim() === newValue
    ) {
        return;
    }

    slot.click();
    await enterValue(ctx, newValue);
    await waitForMenu(ctx);
}

export async function setStringValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string,
): Promise<void> {
    const newValue = value.toString();
    const currentValue = readStringValue(slot);
    if (
        currentValue !== null &&
        currentValue === newValue
    ) {
        return;
    }

    slot.click();
    await enterValue(ctx, newValue);
    await waitForMenu(ctx);
}

export async function setStringOrPaginatedOptionValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string,
): Promise<void> {
    const newValue = value.toString();
    const currentValue = readStringValue(slot);
    if (currentValue !== null && currentValue === newValue) {
        return;
    }

    const slotName = removedFormatting(slot.getItem().getName()).trim();
    slot.click();

    const inputMode = await ctx.withTimeout(
        Promise.race([
            waitForChatInputPrompt(ctx).then(() => "CHAT" as const),
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
            waitForMenu(ctx).then(() => "MENU" as const),
        ]),
        `Waiting to edit "${slotName}"`,
    );

    switch (inputMode) {
        case "CHAT":
            ctx.sendMessage(newValue);
            await waitForMenu(ctx);
            return;
        case "ANVIL":
            await waitForMenu(ctx);
            setAnvilItemName(newValue);
            acceptNewAnvilItem();
            await waitForMenu(ctx);
            return;
        case "MENU": {
            const optionSlot = await getSlotPaginate(ctx, newValue);
            if (isAlreadySelectedOption(optionSlot)) {
                await clickGoBack(ctx);
                return;
            }

            optionSlot.click();
            await waitForMenu(ctx);
            if (ctx.tryGetItemSlot(slotName) !== null) {
                return;
            }

            await clickGoBack(ctx);
            return;
        }
        default:
            const _exhaustiveCheck: never = inputMode;
            return _exhaustiveCheck;
    }
}
