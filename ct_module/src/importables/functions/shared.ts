import type { FunctionIcon } from "htsw/types";

import {
    clickGoBack,
    getSlotPaginate,
    setNumberValue,
    timedWaitForMenu,
} from "../../importer/helpers";
import { setItemValue } from "../../importer/items";
import { parseLoreKeyValueLine } from "../../importer/loreParsing";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";
import { S30PacketWindowItems } from "../../utils/packets";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero } from "../../tasks/specifics/waitFor";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");
const NBTTagCompound = Java.type("net.minecraft.nbt.NBTTagCompound");

/**
 * Strip Hypixel's `(#NNNN)` per-housing function id off a function-list
 * slot's display name and filter out non-function nav slots.
 *
 * Used by both the user-click capture flow (`captureFromHousing`) and
 * the `/export all function` walker (`listFunctions`). Returns the
 * bare function name (usable directly with `/function edit`), or null
 * if the slot isn't a function (nav button, Create Function, empty).
 */
export function extractFunctionNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    if (
        lower === "go back" ||
        lower === "close" ||
        lower === "create function" ||
        lower.indexOf("previous page") >= 0 ||
        lower.indexOf("next page") >= 0
    ) {
        return null;
    }
    const m = trimmed.match(/^(.+?)\s*\(#\d+\)\s*$/);
    return m !== null ? m[1] : trimmed;
}

export async function openFunctionEditor(
    ctx: TaskContext,
    name: string
): Promise<"opened" | "missing"> {
    await ctx.runCommand(`/function edit ${name}`);

    const menuWaiter = ctx.waitFor("packetReceived", (packet) => {
        if (!(packet instanceof S30PacketWindowItems)) return false;
        const windowID = packet.func_148911_c();
        return (
            windowID !== 0 &&
            windowID !==
                lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero
        );
    });
    const messageWaiter = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a function with that name!"
    );

    const exists = await ctx.withTimeout(
        Promise.race([
            menuWaiter.then(() => true),
            messageWaiter.then(() => false),
        ]),
        "Waiting for function to open"
    );

    if (exists) {
        messageWaiter.cleanupWaiter?.();
        await ctx.waitFor("tick");
    } else {
        menuWaiter.cleanupWaiter?.();
    }

    return exists ? "opened" : "missing";
}

export async function ensureFunctionExists(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const status = await openFunctionEditor(ctx, name);
    if (status === "opened") return;

    await ctx.runCommand(`/function create ${name}`);
    await timedWaitForMenu(ctx, "commandMenuWait");
}

export async function ensureFunctionNamesExist(
    ctx: TaskContext,
    functionNames: readonly string[]
): Promise<void> {
    const names = unique(functionNames);
    if (names.length === 0) return;

    ctx.displayMessage(`&7Ensuring ${names.length} function shell(s) exist.`);

    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        ctx.displayMessage(`&7  [shell ${i + 1}/${names.length}] ${String(name)}`);
        if (i > 0) await ctx.sleep(300);
        await ensureFunctionExists(ctx, name);
        await clickGoBack(ctx);
    }
}

export async function openFunctionSettings(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const listSlot = await getSlotPaginate(ctx, name);
    listSlot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

export function readAutomaticExecutionTicks(ctx: TaskContext): number | undefined {
    const autoExecSlot = ctx.tryGetItemSlot("Automatic Execution");
    if (autoExecSlot === null) {
        return undefined;
    }

    for (const line of autoExecSlot.getItem().getLore()) {
        const kv = parseLoreKeyValueLine(line);
        if (!kv || kv.label !== "Current") continue;
        const ticks = parseInt(removedFormatting(kv.value).trim(), 10);
        if (!isNaN(ticks) && ticks > 0) {
            return ticks;
        }
        break;
    }

    return undefined;
}

export async function setAutomaticExecutionTicksIfNeeded(
    ctx: TaskContext,
    repeatTicks: number
): Promise<void> {
    const autoExecSlot = ctx.getItemSlot("Automatic Execution");
    const currentTicks = readAutomaticExecutionTicks(ctx);
    if (currentTicks === repeatTicks) {
        return;
    }

    await setNumberValue(ctx, autoExecSlot, repeatTicks);
}

export function readFunctionIcon(ctx: TaskContext): FunctionIcon | undefined {
    const iconSlot = ctx.tryGetItemSlot("Edit Icon");
    if (iconSlot === null) return undefined;

    const stack = iconSlot.getItem().getItemStack();
    if (stack === null || stack === undefined) return undefined;

    const compound = new NBTTagCompound();
    stack.func_77955_b(compound);
    const id: string = compound.func_74779_i("id");
    const count: number = compound.func_74771_c("Count");

    if (!id) return undefined;

    return count > 1 ? { item: id, count } : { item: id };
}

export async function setFunctionIconIfNeeded(
    ctx: TaskContext,
    icon: FunctionIcon
): Promise<void> {
    const current = readFunctionIcon(ctx);
    if (
        current !== undefined &&
        current.item === icon.item &&
        (current.count ?? 1) === (icon.count ?? 1)
    ) {
        return;
    }

    await setItemValue(ctx, "Edit Icon", createPlainIconItem(icon));
}

function createPlainIconItem(icon: FunctionIcon): Item {
    // @ts-ignore func_111206_d is Item.getByNameOrId in 1.8.
    const mcItem = McItem.func_111206_d(icon.item);
    if (mcItem === null) {
        throw new Error(`Unknown function icon item '${icon.item}'`);
    }

    // @ts-ignore ChatTriggers' TS declarations do not expose this NMS constructor.
    return new Item(new ItemStack(mcItem, icon.count ?? 1));
}
