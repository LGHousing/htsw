import type { FunctionIcon, ImportableFunction } from "htsw/types";

import {
    clickGoBack,
    getSlotPaginate,
    setNumberValue,
} from "../../importer/gui/helpers";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import { setItemValue } from "../../importer/items/items";
import { parseLoreKeyValueLine } from "../../importer/fields/loreParsing";
import { isUnspawnableItem } from "../../importer/fields/unspawnableItems";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";
import {
    getSessionFunctionNamesLower,
    noteFunctionCreated,
} from "./listFunctions";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");

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

    const menuWait = timedWaitForMenu(ctx, "commandMenuWait");
    const msgWait = ctx.waitFor(
        "message",
        (message) =>
            removedFormatting(message) ===
            "Could not find a function with that name!"
    );
    const exists = await ctx.withTimeout(
        ctx.race<boolean>([
            [menuWait.then(() => true), menuWait],
            [msgWait.then(() => false), msgWait],
        ]),
        "Waiting for function to open"
    );

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
    noteFunctionCreated(name);
}

export async function ensureFunctionNamesExist(
    ctx: TaskContext,
    functionNames: readonly string[],
    onEach?: (name: string) => void
): Promise<void> {
    const names = unique(functionNames);
    if (names.length === 0) return;

    // Use the session-cached function name set — read once per import, not once
    // per imported function.
    const existing = await getSessionFunctionNamesLower(ctx);

    const missing: string[] = [];
    for (let i = 0; i < names.length; i++) {
        if (!existing.has(names[i].toLowerCase())) {
            missing.push(names[i]);
        }
    }

    for (let i = 0; i < missing.length; i++) {
        const name = missing[i];
        await ctx.runCommand(`/function create ${name}`);
        await timedWaitForMenu(ctx, "commandMenuWait");
        await clickGoBack(ctx);
        noteFunctionCreated(name);
    }

    for (let i = 0; i < names.length; i++) {
        onEach?.(names[i]);
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
    const currentTicks = readAutomaticExecutionTicks(ctx) ?? 0;
    if (currentTicks === repeatTicks) {
        return;
    }

    await setNumberValue(ctx, autoExecSlot, repeatTicks);
}

export async function setFunctionIconIfNeeded(
    ctx: TaskContext,
    icon: FunctionIcon
): Promise<void> {
    if (isUnspawnableItem(icon.item)) {
        ctx.displayMessage(
            `&e[htsw] Can't set icon to '${icon.item}' — Hypixel won't let you spawn that item.`
        );
        return;
    }
    await setItemValue(ctx, "Edit Icon", createPlainIconItem(icon));
}

/**
 * Assuming the function-settings menu is open, apply the icon and
 * automatic-execution tick count from `importable`. Both setters short-circuit
 * when the current value already matches, so this is a no-op for an already
 * in-sync function. Shared by the preread fast-path and the apply pass.
 */
export async function applyFunctionSettings(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<void> {
    if (importable.icon) {
        await setFunctionIconIfNeeded(ctx, importable.icon);
    }
    await setAutomaticExecutionTicksIfNeeded(ctx, importable.repeatTicks ?? 0);
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
