import type { FunctionIcon } from "htsw/types";

import {
    clickGoBack,
    getSlotPaginate,
    setNumberValue,
    waitForMenu,
} from "../../importer/helpers";
import { setItemValue } from "../../importer/items";
import { parseLoreKeyValueLine } from "../../importer/loreParsing";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";

const McItem = Java.type("net.minecraft.item.Item");
const ItemStack = Java.type("net.minecraft.item.ItemStack");

const REFERENCED_FUNCTION_COMMAND_INTERVAL_MS = 250;

interface FunctionCommandGate {
    beforeFunctionCommand(): Promise<void>;
}

export async function openFunctionEditor(
    ctx: TaskContext,
    name: string,
    commandGate?: FunctionCommandGate
): Promise<"opened" | "missing"> {
    await commandGate?.beforeFunctionCommand();
    ctx.runCommand(`/function edit ${name}`);

    const exists = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a function with that name!"
                )
                .then(() => false),
        ]),
        "Waiting for function to open"
    );

    return exists ? "opened" : "missing";
}

export async function ensureFunctionExists(
    ctx: TaskContext,
    name: string,
    commandGate?: FunctionCommandGate
): Promise<void> {
    const status = await openFunctionEditor(ctx, name, commandGate);
    if (status === "opened") return;

    await commandGate?.beforeFunctionCommand();
    ctx.runCommand(`/function create ${name}`);
    await waitForMenu(ctx);
}

export async function ensureFunctionNamesExist(
    ctx: TaskContext,
    functionNames: readonly string[]
): Promise<void> {
    const names = Array.from(new Set(functionNames));
    if (names.length === 0) return;

    ctx.displayMessage(`&7Ensuring ${names.length} function shell(s) exist.`);

    const commandGate = createFunctionCommandGate(ctx);
    for (const name of names) {
        await ensureFunctionExists(ctx, name, commandGate);
        await clickGoBack(ctx);
    }
}

function createFunctionCommandGate(ctx: TaskContext): FunctionCommandGate {
    let nextCommandAt = 0;

    return {
        async beforeFunctionCommand(): Promise<void> {
            const waitMs = nextCommandAt - Date.now();
            if (waitMs > 0) {
                await ctx.sleep(waitMs);
            }
            nextCommandAt = Date.now() + REFERENCED_FUNCTION_COMMAND_INTERVAL_MS;
        },
    };
}

export async function openFunctionSettings(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const listSlot = await getSlotPaginate(ctx, name);
    listSlot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
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

export async function setFunctionIconIfNeeded(
    ctx: TaskContext,
    icon: FunctionIcon
): Promise<void> {
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
