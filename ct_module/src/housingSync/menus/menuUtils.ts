import type { Location } from "htsw/types";

import TaskContext from "../../tasks/context";
import { ItemSlot, MouseButton, menuStateDescription } from "../../tasks/specifics/slots";

// MC 1.8.9 anvil rename field cap (GuiRepair name field maxStringLength).
const ANVIL_NAME_MAX = 35;
import { removedFormatting } from "../../utils/helpers";
import {
    S2DPacketOpenWindow,
    openWindowPacketGuiId,
    openWindowPacketId,
} from "../../utils/packets";
import {
    normalizeLoreValueFormatting,
    normalizeNoteText,
    readListItemNote,
    stripHousingEditorValuePrefix,
    stripWrapInheritedColor,
} from "../fields/loreParsing";
import {
    timedWaitForMenu,
    waitForKnownMenu,
    waitForMenu,
} from "./menuWait";
import { getVisiblePaginatedItemSlots } from "./paginatedList";
import { decideStringWrite } from "./stringValueDecision";
import { COST } from "../progress/costs";
import { recordTimedOp } from "../progress/timing";
import { isTaskTraceEnabled, traceNote } from "../trace/taskTrace";
import type { WaitForPromise } from "../../tasks/specifics/waitFor";

const GuiEditSign = Java.type("net.minecraft.client.gui.inventory.GuiEditSign");
const C12PacketUpdateSign = Java.type("net.minecraft.network.play.client.C12PacketUpdateSign");
const ChatComponentText = Java.type("net.minecraft.util.ChatComponentText");
const IChatComponent = Java.type("net.minecraft.util.IChatComponent");
const JavaArray = Java.type("java.lang.reflect.Array");

type SignTile = {
    func_174877_v(): unknown;
};

function describeVisibleOptions(ctx: TaskContext): string {
    const names: string[] = [];
    const slots = getVisiblePaginatedItemSlots(ctx);
    for (let i = 0; i < slots.length && names.length < 40; i++) {
        const n = removedFormatting(slots[i].getItem().getName()).trim();
        if (n.length > 0) names.push(n);
    }
    return names.length === 0 ? "<empty>" : names.join(", ");
}

// Dump every filled menu slot as id:name, falling back to the first lore line
// when the slot has no display name (e.g. unlabeled pagination arrows). Lets us
// see where/how a paginated picker exposes its next/prev controls.
function describeAllMenuSlots(ctx: TaskContext): string {
    const slots = ctx.getMenuItemSlots();
    if (slots === null) return "<no container>";
    const parts: string[] = [];
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const item = slot.getItem();
        let label = removedFormatting(item.getName()).trim();
        if (label.length === 0) {
            const lore = item.getLore();
            label = lore.length > 0 ? `lore:"${removedFormatting(lore[0]).trim()}"` : "<unnamed>";
        }
        parts.push(`${slot.getSlotId()}:${label}`);
    }
    return parts.length === 0 ? "<empty>" : parts.join(", ");
}


async function scanPagesForOption(
    ctx: TaskContext,
    name: string
): Promise<ItemSlot | null> {
    await goToFirstPaginatedOptionPage(ctx);
    for (let page = 0; page < 100; page++) {
        const slot = ctx.tryGetMenuItemSlot(name);
        if (slot !== null) return slot;

        if (isTaskTraceEnabled()) {
            traceNote("paginate", `page ${page}: ${describeVisibleOptions(ctx)}`);
        }

        const nextPageSlot = findPaginationControl(ctx, "next");
        if (nextPageSlot === null) break;
        nextPageSlot.click();
        await timedWaitForMenu(ctx, "pageTurnWait");
    }
    return null;
}

const PAGINATE_RESCAN_ATTEMPTS = 3;

export async function getSlotPaginate(ctx: TaskContext, name: string): Promise<ItemSlot> {
    for (let attempt = 0; attempt < PAGINATE_RESCAN_ATTEMPTS; attempt++) {
        const found = await scanPagesForOption(ctx, name);
        if (found !== null) {
            if (attempt > 0) {
                traceNote(
                    "paginate",
                    `found "${name}" only after ${attempt} rescan(s) — menu was still populating when first scanned`
                );
            }
            return found;
        }
        if (attempt < PAGINATE_RESCAN_ATTEMPTS - 1) {
            // Menu may still be streaming items in (multi-packet population).
            // Give it a tick and rescan from page 1 before concluding absence.
            await ctx.waitFor("tick");
        }
    }

    const detail = `${menuStateDescription()} — all slots: [${describeAllMenuSlots(ctx)}]`;
    throw new Error(`Could not find "${name}" on any page after ${PAGINATE_RESCAN_ATTEMPTS} attempts.${detail}`);
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
    const slot = ctx.tryGetMenuItemSlot("Go Back");
    if (slot === null) {
        // No "Go Back" here means we're a level higher than the caller assumed —
        // a top-level editor (the region editor has "Close", not "Go Back") or a
        // nav unwind that popped one level too far. Name the menu so the desync's
        // origin is visible instead of a bare "Could not find Go Back".
        throw new Error(`Could not find "Go Back" to click back from${menuStateDescription()}`);
    }
    slot.click();
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
    // @ts-expect-error Rhino reflection return types do not expose Java members.
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container);

    const outputSlotItemField = outputSlot.class.getDeclaredField("field_70467_a");
    outputSlotItemField.setAccessible(true);
    const outputSlotItem = outputSlotItemField.get(outputSlot);

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

function currentScreen(): unknown {
    return Client.getMinecraft().field_71462_r;
}

function isSignEditorOpen(): boolean {
    return currentScreen() instanceof GuiEditSign;
}

function getDeclaredFieldInHierarchy(obj: unknown, name: string) {
    let cls = (obj as { class: { getDeclaredField(name: string): unknown; getSuperclass(): unknown } }).class;
    while (cls !== null) {
        try {
            const field = cls.getDeclaredField(name) as {
                setAccessible(value: boolean): void;
                get(target: unknown): unknown;
                set(target: unknown, value: unknown): void;
            };
            field.setAccessible(true);
            return field;
        } catch (_e) {
            cls = cls.getSuperclass() as typeof cls;
        }
    }
    throw new Error(`Could not find field ${name}`);
}

function chatComponentLines(lines: string[]) {
    const array = JavaArray.newInstance(IChatComponent.class, 4);
    for (let i = 0; i < 4; i++) {
        JavaArray.set(array, i, new ChatComponentText(lines[i] ?? ""));
    }
    return array;
}

function submitSignValue(value: string): void {
    const screen = currentScreen();
    if (!(screen instanceof GuiEditSign)) {
        throw new Error("Sign input was expected, but the sign editor is not open.");
    }

    const sign = getDeclaredFieldInHierarchy(screen, "field_146848_f").get(screen) as SignTile;
    const lines = chatComponentLines([value, "", "", ""]);
    getDeclaredFieldInHierarchy(sign, "field_145915_a").set(sign, lines);
    Client.sendPacket(new C12PacketUpdateSign(sign.func_174877_v(), lines));
    Client.getMinecraft().func_147108_a(null);
}

export async function setListItemNote(
    ctx: TaskContext,
    slot: ItemSlot,
    note: string | undefined,
    options?: { onApplied?: () => void }
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
    options?.onApplied?.();
    await timedWaitForMenu(ctx, "menuClickWait");
}

function readCurrentValue(slot: ItemSlot): string | null {
    const lines = readCurrentValueLines(slot);
    if (lines === null) {
        return null;
    }

    return lines[0] ?? null;
}

function readCurrentValueLines(slot: ItemSlot): string[] | null {
    const lore = slot.getItem().getLore();
    let index = -1;
    for (let i = 0; i < lore.length; i++) {
        if (removedFormatting(lore[i]) === "Current Value:") {
            index = i;
            break;
        }
    }
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

function readSelectedOption(
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
        .map((line, i) => {
            const normalized = stripHousingEditorValuePrefix(
                normalizeLoreValueFormatting(line)
            ).trim();
            return i === 0 ? normalized : stripWrapInheritedColor(normalized);
        })
        .join(" ");
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
    const currentStripped = currentValue === null ? null : removedFormatting(currentValue);
    if (currentStripped === newValue) return;

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function setSelectValue(
    ctx: TaskContext,
    slotName: string,
    value: string
): Promise<void> {
    const currentSlot = ctx.tryGetMenuItemSlot(slotName);
    if (currentSlot !== null) {
        const currentValue = readStringValue(currentSlot);
        if (currentValue !== null && currentValue === value) return;
    }

    await openSubmenu(ctx, slotName);

    const optionSlot = await getSlotPaginate(ctx, value);
    if (isAlreadySelectedOption(optionSlot)) {
        await clickGoBack(ctx);
        return;
    }

    optionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    if (ctx.tryGetMenuItemSlot(slotName) !== null) return;

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

export async function enterValue(ctx: TaskContext, value: string): Promise<"CHAT" | "ANVIL" | "SIGN"> {
    const chatWait = waitForChatInputPrompt(ctx);
    const anvilWait = ctx.waitFor("packetReceived", (packet) => {
        return (
            packet instanceof S2DPacketOpenWindow &&
            openWindowPacketGuiId(packet) === "minecraft:anvil"
        );
    });
    const signWait = ctx.waitFor("tick", isSignEditorOpen);
    const anvilMode = anvilWait.then((args) => ({
        mode: "ANVIL" as const,
        windowId: openWindowPacketId(args[0]) ?? 0,
    }));
    const inputMode = await ctx.withTimeout(
        ctx.race<"CHAT" | "SIGN" | { mode: "ANVIL"; windowId: number }>([
            [chatWait.then(() => "CHAT" as const), chatWait],
            [anvilMode, anvilWait],
            [signWait.then(() => "SIGN" as const), signWait],
        ]),
        "Waiting for input mode to be determined",
        8000
    );

    if (inputMode === "CHAT") {
        await ctx.sendMessage(value);
        return "CHAT";
    }
    if (inputMode === "SIGN") {
        submitSignValue(value);
        return "SIGN";
    }
    if (value.length > ANVIL_NAME_MAX) {
        throw new Error(
            `Value is ${value.length} characters — too long for Housing's anvil ` +
            `input (max ${ANVIL_NAME_MAX}). Set "Preferred Input" to "Chat" in your ` +
            `Housing settings, then re-import.`
        );
    }
    await waitForKnownMenu(ctx, inputMode.windowId, true);
    setAnvilItemName(value);
    acceptNewAnvilItem();
    return "ANVIL";
}

function valueInputTiming(mode: "CHAT" | "ANVIL" | "SIGN"): {
    kind: "chatInput" | "anvilInput" | "signInput";
    units: number;
} {
    if (mode === "CHAT") return { kind: "chatInput", units: COST.chatInput };
    if (mode === "SIGN") return { kind: "signInput", units: COST.signInput };
    return { kind: "anvilInput", units: COST.anvilInput };
}

function waitForChatInputPrompt(ctx: TaskContext): WaitForPromise<unknown> {
    return ctx.waitFor("message", (message) => {
        return removedFormatting(message).includes(
            "Please use the chat to provide the value you wish to set."
        );
    });
}

export async function setNumberValue(ctx: TaskContext, slot: ItemSlot, value: number) {
    const newValue = value.toString();
    const currentValue = readCurrentValue(slot);
    if (currentValue !== null) {
        const currentNumber = Number(
            removedFormatting(currentValue).trim().split(",").join("")
        );
        if (Number.isFinite(currentNumber) && currentNumber === value) {
            return;
        }
    }

    slot.click();
    const started = Date.now();
    const mode = await enterValue(ctx, newValue);
    await waitForMenu(ctx);
    const timing = valueInputTiming(mode);
    recordTimedOp(timing.kind, timing.units, Date.now() - started);
}

export async function setStringValue(
    ctx: TaskContext,
    slot: ItemSlot,
    value: string
): Promise<void> {
    const newValue = value.toString();
    const currentValue = readStringValue(slot);
    const action = decideStringWrite(currentValue, newValue);
    if (action === "skip") return;
    if (action === "cannot-clear") {
        const slotName = removedFormatting(slot.getItem().getName()).trim();
        throw new Error(
            `Cannot set "${slotName}" to an empty value through Housing's chat input. ` +
            `Use a formatting-only value like "&k" instead of an empty one.`
        );
    }

    slot.click();
    const started = Date.now();
    const mode = await enterValue(ctx, newValue);
    await waitForMenu(ctx);
    const timing = valueInputTiming(mode);
    recordTimedOp(timing.kind, timing.units, Date.now() - started);
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

    const chatWait = waitForChatInputPrompt(ctx);
    const anvilWait = ctx.waitFor("packetReceived", (packet) => {
        return (
            packet instanceof S2DPacketOpenWindow &&
            openWindowPacketGuiId(packet) === "minecraft:anvil"
        );
    });
    const menuWait = waitForMenu(ctx);
    const anvilMode = anvilWait.then((args) => ({
        mode: "ANVIL" as const,
        windowId: openWindowPacketId(args[0]) ?? 0,
    }));
    const inputMode = await ctx.withTimeout(
        ctx.race<"CHAT" | "MENU" | { mode: "ANVIL"; windowId: number }>([
            [chatWait.then(() => "CHAT" as const), chatWait],
            [anvilMode, anvilWait],
            [menuWait.then(() => "MENU" as const), menuWait],
        ]),
        `Waiting to edit "${slotName}"`,
        8000
    );

    if (inputMode !== "CHAT" && inputMode !== "MENU") {
        await waitForKnownMenu(ctx, inputMode.windowId, true);
        setAnvilItemName(newValue);
        acceptNewAnvilItem();
        await waitForMenu(ctx);
        return;
    }

    switch (inputMode) {
        case "CHAT":
            await ctx.sendMessage(newValue);
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
    note: string | undefined,
    options?: { onApplied?: () => void }
): Promise<void> {
    if (!note) return;
    const slots = getVisiblePaginatedItemSlots(ctx);
    const last = slots[slots.length - 1];
    if (last) {
        await setListItemNote(ctx, last, note, options);
    }
}
