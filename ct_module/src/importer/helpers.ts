import TaskContext from "../tasks/context";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { normalizeFormattingCodes, removedFormatting } from "../utils/helpers";
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../tasks/specifics/waitFor";
import type { UiFieldKind } from "./types";

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
    do {
        const slot = ctx.tryGetItemSlot(name);
        if (slot !== null) return slot;

        const nextPageSlot = ctx.tryGetItemSlot("Left-click for next page!");
        if (nextPageSlot === null) break;
        nextPageSlot.click();
        await waitForMenu(ctx);
    } while (true);

    throw new Error(`Could not find "${name}" on any page.`);
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

export function parseLoreKeyValueLine(
    line: string,
): { label: string; value: string } | null {
    const unformattedLine = removedFormatting(line).trim();
    if (unformattedLine.startsWith("minecraft:") || unformattedLine.startsWith("NBT:")) {
        return null;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
        return null;
    }

    const label = removedFormatting(line.slice(0, separatorIndex)).trim();
    const rawValue = line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (label === "") {
        return null;
    }

    return { label, value };
}

export function parseBooleanText(value: string): boolean | undefined {
    const normalized = removedFormatting(value).trim();
    if (normalized === "Enabled") {
        return true;
    }
    if (normalized === "Disabled") {
        return false;
    }
    return undefined;
}

export function normalizeLoreValueFormatting(value: string): string {
    const normalized = normalizeFormattingCodes(value);
    let index = 0;

    while (normalized.slice(index, index + 2).toLowerCase() === "&r") {
        index += 2;
    }

    if (normalized.slice(index, index + 2).toLowerCase() === "&f") {
        index += 2;
    }

    while (normalized.slice(index, index + 2).toLowerCase() === "&r") {
        index += 2;
    }

    return normalized.slice(index);
}

export function parseFieldValue(
    kind: UiFieldKind,
    value: string,
): string | boolean | undefined {
    switch (kind) {
        case "value":
            return normalizeLoreValueFormatting(value);
        case "cycle":
        case "select":
        case "item":
            return removedFormatting(value).trim();
        case "boolean":
            return parseBooleanText(value);
        case "nestedList":
            return undefined;
        default:
            const _exhaustiveCheck: never = kind;
            return _exhaustiveCheck;
    }
}

export function parseLoreFields<TProp extends string>(
    slot: ItemSlot,
    loreFields: Record<string, { prop: TProp; kind: UiFieldKind }>,
): Partial<Record<TProp, string | boolean>> {
    const parsed: Partial<Record<TProp, string | boolean>> = {};

    for (const line of slot.getItem().getLore()) {
        const keyValue = parseLoreKeyValueLine(line);
        if (keyValue === null) {
            continue;
        }

        const field = loreFields[keyValue.label];
        if (!field) {
            continue;
        }

        const value = parseFieldValue(field.kind, keyValue.value);
        if (value === undefined) {
            continue;
        }

        parsed[field.prop] = value;
    }

    return parsed;
}

export function readListItemNote(slot: ItemSlot): string | undefined {
    const lore = slot
        .getItem()
        .getLore()
        .map((line) => removedFormatting(line).trim());

    const instructionPatterns = [
        "Right Click to remove!",
        "Left Click to edit!",
        "Click to edit!",
        "Use shift and left/right click to change order.",
    ];

    let instructionIndex = -1;
    for (let i = 0; i < lore.length; i++) {
        if (instructionPatterns.indexOf(lore[i]) !== -1) {
            instructionIndex = i;
        }
    }
    if (instructionIndex === -1) {
        return undefined;
    }

    const noteLines: string[] = [];
    let inNote = false;
    for (let i = instructionIndex + 1; i < lore.length; i++) {
        const line = lore[i];

        if (!inNote && line === "") {
            continue;
        }

        if (
            line.startsWith("minecraft:") ||
            line.startsWith("NBT:") ||
            line.startsWith("LSHIFT ") ||
            line.startsWith("SHIFT ")
        ) {
            break;
        }

        inNote = true;
        noteLines.push(line);
    }

    if (noteLines.length === 0) {
        return undefined;
    }

    return noteLines.join("\n");
}

export function normalizeNoteText(note: string): string {
    return note
        .split("\n")
        .map((line) => normalizeLoreValueFormatting(line).trim())
        .join("\n")
        .trim();
}

export function readCurrentValue(slot: ItemSlot): string | null {
    const lore = slot.getItem().getLore();
    const index = lore.findIndex(
        (line, _i) => removedFormatting(line) === "Current Value:",
    );
    if (index === -1) return null;

    if (index + 1 >= lore.length) {
        return null;
    }
    return lore[index + 1];
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
    const currentValue = readCurrentValue(slot);
    if (currentValue === null) {
        return null;
    }

    return normalizeLoreValueFormatting(currentValue);
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

async function enterValue(ctx: TaskContext, value: string) {
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
}

export async function setStringValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string,
): Promise<void> {
    const newValue = value.toString();
    const currentValue = readCurrentValue(slot);
    if (
        currentValue !== null &&
        normalizeLoreValueFormatting(currentValue) === newValue
    ) {
        return;
    }

    slot.click();
    await enterValue(ctx, newValue);
    await waitForMenu(ctx);
}
