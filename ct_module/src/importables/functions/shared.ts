import type { FunctionIcon, ImportableFunction } from "htsw/types";

import {
    clickGoBack,
    getSlotPaginate,
    setNumberValue,
} from "../../housingSync/gui/menuUtils";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import { setItemValue } from "../../housingSync/items/injectItem";
import { parseLoreKeyValueLine } from "../../housingSync/fields/loreParsing";
import { isUnspawnableItem } from "../../housingSync/fields/unspawnableItems";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";
import {
    createIconItem,
    desiredIconSnapshot,
    iconSnapshotsEqual,
    iconStacksEqual,
} from "./icon";
import {
    getSessionFunctionIcon,
    getSessionFunctionNamesLower,
    noteFunctionCreated,
} from "./listFunctions";

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
    // Warm the /functions icon-list cache now, while we're still in the list. A
    // later functionIconMatches (inside applyFunctionSettings, with the settings
    // menu open) would otherwise lazily read /functions and navigate out of that
    // menu — the "Could not find Automatic Execution" failure for a function that
    // has both actions and an icon (the actions path never warms this in preread).
    await getSessionFunctionIcon(ctx, name);
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

async function setAutomaticExecutionTicksIfNeeded(
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

async function setFunctionIconIfNeeded(
    ctx: TaskContext,
    icon: FunctionIcon
): Promise<void> {
    if (isUnspawnableItem(icon.item)) {
        ctx.displayMessage(
            `&e[htsw] Can't set icon to '${icon.item}' — Hypixel won't let you spawn that item.`
        );
        return;
    }
    // An icon is only ever {item, count}; match the picker selection on those,
    // not the exact-NBT compare used for GIVE_ITEM (which would never match a
    // freshly creative-spawned stack and falsely report "never appeared").
    await setItemValue(ctx, "Edit Icon", createIconItem(icon), iconStacksEqual);
}

async function functionSettingsStep<T>(
    label: string,
    run: () => Promise<T>
): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: ${message}`);
    }
}

/**
 * Assuming the function-settings menu is open, apply the icon and
 * automatic-execution tick count from `importable`. Both setters short-circuit
 * when the current value already matches — the icon against its /functions-list
 * snapshot, the ticks against the live field — so this is a no-op for an
 * already in-sync function. Shared by the preread fast-path and the apply pass.
 */
export async function applyFunctionSettings(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<void> {
    if (importable.icon !== undefined && !(await functionIconMatches(ctx, importable))) {
        await functionSettingsStep(
            `setting icon for function ${importable.name}`,
            () => setFunctionIconIfNeeded(ctx, importable.icon!)
        );
    }
    await functionSettingsStep(
        `setting automatic execution for function ${importable.name}`,
        () => setAutomaticExecutionTicksIfNeeded(ctx, importable.repeatTicks ?? 0)
    );
}

/**
 * Whether the function's icon already matches the desired one, read straight
 * from the cached /functions list (no settings menu open). True when there's no
 * desired icon — nothing to apply.
 */
export async function functionIconMatches(
    ctx: TaskContext,
    importable: ImportableFunction
): Promise<boolean> {
    if (importable.icon === undefined) return true;
    const current = await getSessionFunctionIcon(ctx, importable.name);
    return iconSnapshotsEqual(current, desiredIconSnapshot(importable.icon));
}
