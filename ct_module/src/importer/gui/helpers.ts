import type { Location } from "htsw/types";

import TaskContext from "../../tasks/context";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { S2DPacketOpenWindow } from "../../utils/packets";
import {
    normalizeLoreValueFormatting,
    normalizeNoteText,
    readListItemNote,
} from "../fields/loreParsing";
import {
    timedWaitForMenu,
    waitForMenu,
} from "./menuWait";
import { getVisiblePaginatedItemSlots } from "./paginatedList";
import { COST } from "../progress/costs";
import { recordTimedOp } from "../progress/timing";

// Re-exported so existing consumers don't need to change their imports.
// Module-graph-wise these now live in `menuWait.ts` so `paginatedList.ts`
// can pull `timedWaitForMenu` from there without creating a helpers ↔
// paginatedList cycle.
export {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
    waitForMenu,
} from "./menuWait";

/** Cycle options shared by `CHANGE_VAR` (action) and `COMPARE_VAR` (condition). */
export const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;

export async function getSlotPaginate(ctx: TaskContext, name: string): Promise<ItemSlot> {
    await goToFirstPaginatedOptionPage(ctx);

    for (let page = 0; page < 100; page++) {
        const slot = ctx.tryGetMenuItemSlot(name);
        if (slot !== null) return slot;

        const nextPageSlot = findPaginationControl(ctx, "next");
        if (nextPageSlot === null) break;
        nextPageSlot.click();
        await timedWaitForMenu(ctx, "pageTurnWait");
    }

    throw new Error(`Could not find "${name}" on any page.`);
}

async function goToFirstPaginatedOptionPage(ctx: TaskContext): Promise<void> {
    for (let page = 0; page < 100; page++) {
        const prevPageSlot = findPaginationControl(ctx, "previous");
        if (prevPageSlot === null) return;
        prevPageSlot.click();
        await timedWaitForMenu(ctx, "pageTurnWait");
    }

    throw new Error("Could not find the first page of this paginated menu.");
}

function findPaginationControl(
    ctx: TaskContext,
    direction: "next" | "previous"
): ItemSlot | null {
    const exactText = `Left-click for ${direction} page!`;
    const exactSlot = ctx.tryGetMenuItemSlot(exactText);
    if (exactSlot !== null) return exactSlot;

    const needle = `${direction} page`;
    return ctx.tryGetMenuItemSlot((slot) => {
        const item = slot.getItem();
        const lines = [item.getName(), ...item.getLore()];
        return lines.some((line) =>
            removedFormatting(line).trim().toLowerCase().includes(needle)
        );
    });
}

export async function clickGoBack(ctx: TaskContext): Promise<void> {
    ctx.getMenuItemSlot("Go Back").click();
    await timedWaitForMenu(ctx, "goBackWait");
}

export async function openSubmenu(ctx: TaskContext, slotName: string): Promise<void> {
    ctx.getMenuItemSlot(slotName).click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

function setAnvilItemName(newName: string) {
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

function acceptNewAnvilItem(): void {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    inventory.click(2, false);
}

export async function setListItemNote(
    ctx: TaskContext,
    slot: ItemSlot,
    note: string | undefined
): Promise<void> {
    const normalizedNote = note === undefined ? undefined : normalizeNoteText(note);
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
        await ctx.runCommand("/chatinput cancel");
    } else {
        await enterValue(ctx, normalizedNote);
    }
    await timedWaitForMenu(ctx, "menuClickWait");
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
        (line, _i) => removedFormatting(line) === "Current Value:"
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

function normalizeSelectedOption(line: string): string {
    return removedFormatting(line)
        .trim()
        .replace(/^[^A-Za-z0-9]+/, "")
        .trim();
}

export function readSelectedOption(
    slot: ItemSlot,
    options: readonly string[]
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
        .map((line) =>
            stripLeadingFormattingCodes(normalizeLoreValueFormatting(line)).trim()
        )
        .join(" ");
}

function stripLeadingFormattingCodes(value: string): string {
    return value.replace(/^(?:&[0-9a-fklmnor])+/i, "");
}

export function findMenuOptionByLore(
    ctx: TaskContext,
    loreLine: string
): ItemSlot | null {
    return ctx.tryGetMenuItemSlot((slot) =>
        slot
            .getItem()
            .getLore()
            .some((line) => removedFormatting(line).trim() === loreLine)
    );
}

function isAlreadySelectedOption(slot: ItemSlot): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) =>
            removedFormatting(line).trim().toLowerCase().includes("already selected")
        );
}

export async function setBooleanValue(ctx: TaskContext, slot: ItemSlot, value: boolean) {
    const newValue = value ? "Enabled" : "Disabled";
    const currentValue = readCurrentValue(slot);
    if (currentValue !== null && removedFormatting(currentValue) === newValue) {
        return;
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function setSelectValue(
    ctx: TaskContext,
    slotName: string,
    value: string
): Promise<void> {
    await openSubmenu(ctx, slotName);

    const optionSlot = await getSlotPaginate(ctx, value);
    if (isAlreadySelectedOption(optionSlot)) {
        await clickGoBack(ctx);
        return;
    }

    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    if (ctx.tryGetMenuItemSlot(slotName) !== null) {
        return;
    }

    await clickGoBack(ctx);
}

export async function setCycleValue(
    ctx: TaskContext,
    slotName: string,
    options: readonly string[],
    value: string
): Promise<void> {
    if (options.indexOf(value) === -1) {
        throw new Error(`"${value}" is not a valid option for "${slotName}".`);
    }

    const getSlot = () => ctx.getMenuItemSlot(slotName);
    const currentValue = readSelectedOption(getSlot(), options);

    if (currentValue === value) {
        return;
    }

    async function clickUntilMatch(
        button: MouseButton,
        maxClicks: number
    ): Promise<boolean> {
        for (let i = 0; i < maxClicks; i++) {
            getSlot().click(button);
            await timedWaitForMenu(ctx, "menuClickWait");

            if (readSelectedOption(getSlot(), options) === value) {
                return true;
            }
        }

        return false;
    }

    if (currentValue !== null) {
        const currentIndex = options.indexOf(currentValue);
        const targetIndex = options.indexOf(value);
        const leftClicks = (targetIndex - currentIndex + options.length) % options.length;
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

export async function enterValue(ctx: TaskContext, value: string): Promise<"CHAT" | "ANVIL"> {
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
        "Waiting for input mode to be determined"
    );

    switch (inputMode) {
        case "CHAT":
            await ctx.sendMessage(value);
            return "CHAT";
        case "ANVIL":
            await waitForMenu(ctx);
            setAnvilItemName(value);
            acceptNewAnvilItem();
            return "ANVIL";
        default:
            const _exhaustiveCheck: never = inputMode;
            throw new Error(`Unknown input mode ${_exhaustiveCheck}`);
    }
}

function waitForChatInputPrompt(ctx: TaskContext): Promise<unknown> {
    return ctx.waitFor("message", (message) => {
        return removedFormatting(message).includes(
            "Please use the chat to provide the value you wish to set."
        );
    });
}

export async function setNumberValue(ctx: TaskContext, slot: ItemSlot, value: number) {
    const newValue = value.toString();
    const currentValue = readCurrentValue(slot);
    if (currentValue !== null && removedFormatting(currentValue).trim() === newValue) {
        return;
    }

    slot.click();
    const started = Date.now();
    const mode = await enterValue(ctx, newValue);
    await waitForMenu(ctx);
    recordTimedOp(mode === "CHAT" ? "chatInput" : "anvilInput", mode === "CHAT" ? COST.chatInput : COST.anvilInput, Date.now() - started);
}

export async function setStringValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string
): Promise<void> {
    const newValue = value.toString();
    const currentValue = readStringValue(slot);
    if (currentValue !== null && currentValue === newValue) {
        return;
    }

    slot.click();
    const started = Date.now();
    const mode = await enterValue(ctx, newValue);
    await waitForMenu(ctx);
    recordTimedOp(mode === "CHAT" ? "chatInput" : "anvilInput", mode === "CHAT" ? COST.chatInput : COST.anvilInput, Date.now() - started);
}

export async function setStringOrPaginatedOptionValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string
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
        `Waiting to edit "${slotName}"`
    );

    switch (inputMode) {
        case "CHAT":
            await ctx.sendMessage(newValue);
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
            if (ctx.tryGetMenuItemSlot(slotName) !== null) {
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

/**
 * Set a location-typed field (TELEPORT, LAUNCH, PLAY_SOUND, ...). "Custom
 * Coordinates" opens the location submenu, picks the option, and enters the
 * coordinate string; every other location type is a plain select.
 */
export async function setLocationValue(
    ctx: TaskContext,
    label: string,
    location: Location
): Promise<void> {
    if (location.type === "Custom Coordinates") {
        await openSubmenu(ctx, label);
        const optionSlot = await getSlotPaginate(ctx, "Custom Coordinates");
        optionSlot.click();
        await enterValue(ctx, location.value);
        await waitForMenu(ctx);
        return;
    }
    await setSelectValue(ctx, label, location.type);
}

/**
 * Detect the Housing "You can't have more of this {action|condition}!" hint
 * on the add-X menu's type slot. Lore-only check; no clicks.
 */
export function isLimitExceeded(slot: ItemSlot, kind: "action" | "condition"): boolean {
    const lore = slot.getItem().getLore();
    if (lore.length === 0) return false;
    const lastLine = lore[lore.length - 1];
    return removedFormatting(lastLine) === `You can't have more of this ${kind}!`;
}

/**
 * After importing a new action/condition (which adds at the end of the
 * paginated list), set the note on the last visible slot. No-op when `note`
 * is undefined.
 */
export async function setNoteOnLastVisibleSlot(
    ctx: TaskContext,
    note: string | undefined
): Promise<void> {
    if (!note) return;
    const slots = getVisiblePaginatedItemSlots(ctx);
    const last = slots[slots.length - 1];
    if (last) {
        await setListItemNote(ctx, last, note);
    }
}
