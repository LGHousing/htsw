import type { FunctionIcon, ImportableFunction } from "htsw/types";
import { isUnspawnableItem } from "htsw";

import {
    clickGoBack,
    resetStringValue,
    setNumberValue,
    setStringValue,
} from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { setItemValue } from "../../housingSync/items/itemPicker";
import {
    normalizeLoreValueFormatting,
    parseLoreKeyValueLine,
    stripWrapInheritedColor,
} from "../../housingSync/fields/loreParsing";
import TaskContext from "../../tasks/context";
import { MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting, unique } from "../../utils/helpers";
import { oneOf } from "../../tasks/waiters";
import { chatMessage } from "../../housingSync/menus/menuWaiters";
import { functionActionEditorOpened } from "../waiters";
import {
    createIconItem,
    functionIconFromSnapshot,
    iconStacksEqual,
} from "./icon";
import {
    getSessionFunctionIcon,
    getSessionFunctionListSlot,
    getSessionFunctionNamesLower,
    noteFunctionCreated,
} from "./listFunctions";
import type {
    FunctionSettingChange,
    ObservedFunctionSettings,
} from "./settings";
import { itemLore } from "../../utils/itemLore";

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
    const result = await ctx.expectAfter(
        () => ctx.runCommand(`/function edit ${name}`),
        oneOf({
            opened: functionActionEditorOpened(name),
            missing: chatMessage("Could not find a function with that name!"),
        })
    );

    return result;
}

export async function ensureFunctionExists(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const status = await openFunctionEditor(ctx, name);
    if (status === "opened") return;

    await ctx.expectAfter(
        () => ctx.runCommand(`/function create ${name}`),
        functionActionEditorOpened(name)
    );
    noteFunctionCreated(name);
}

export async function ensureFunctionNamesExist(
    ctx: TaskContext,
    functionNames: readonly string[],
    onCreated?: (name: string) => void | Promise<void>
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
        await ctx.expectAfter(
            () => ctx.runCommand(`/function create ${name}`),
            functionActionEditorOpened(name)
        );
        await clickGoBack(ctx);
        noteFunctionCreated(name);
        await onCreated?.(name);
    }
}

export async function openFunctionSettings(
    ctx: TaskContext,
    name: string
): Promise<void> {
    const listSlot = await getSessionFunctionListSlot(ctx, name);
    listSlot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

function readAutomaticExecutionTicks(ctx: TaskContext): number | undefined {
    const autoExecSlot = ctx.tryGetItemSlot("Automatic Execution");
    if (autoExecSlot === null) {
        return undefined;
    }

    for (const line of itemLore(autoExecSlot.getItem())) {
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

function readFunctionDescription(ctx: TaskContext): string | undefined {
    return parseFunctionDescriptionLore(
        itemLore(ctx.getItemSlot("Edit Description").getItem())
    );
}

/**
 * Parse the "Edit Description" item lore: the description sits between the
 * first blank line and the next blank line or the "Click to rename!"
 * sentinel. Exported for unit tests.
 */
export function parseFunctionDescriptionLore(
    lore: readonly string[]
): string | undefined {
    let separator = -1;
    for (let i = 0; i < lore.length; i++) {
        if (removedFormatting(lore[i]).trim() === "") {
            separator = i;
            break;
        }
    }
    if (separator === -1) {
        throw new Error("Could not read function description.");
    }

    const lines: string[] = [];
    for (let i = separator + 1; i < lore.length; i++) {
        if (removedFormatting(lore[i]).trim() === "") break;
        const line = stripWrapInheritedColor(
            normalizeLoreValueFormatting(lore[i])
        ).trim();
        if (removedFormatting(lore[i]).trim() === "Click to rename!") break;
        lines.push(line);
    }
    return lines.length === 0 ? undefined : lines.join(" ");
}

async function setFunctionDescription(
    ctx: TaskContext,
    description: string
): Promise<void> {
    const slot = ctx.getItemSlot("Edit Description");
    if (description === "") {
        await resetStringValue(ctx, slot);
        return;
    }
    await setStringValue(ctx, slot, description);
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
    // Match the picker selection by function-icon fields, not the exact NBT
    // comparison used for GIVE_ITEM.
    await setItemValue(ctx, "Edit Icon", createIconItem(icon), iconStacksEqual);
}

async function functionSettingsStep<T>(label: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: ${message}`);
    }
}

/**
 * Assuming the function-settings menu is open, apply requested metadata from
 * `importable`.
 */
export async function applyFunctionSettings(
    ctx: TaskContext,
    importable: ImportableFunction,
    changes: readonly FunctionSettingChange[]
): Promise<void> {
    for (const change of changes) {
        switch (change.key) {
            case "description":
                await functionSettingsStep(
                    `setting description for function ${importable.name}`,
                    () => setFunctionDescription(ctx, change.desired ?? "")
                );
                break;
            case "icon": {
                const icon = change.desired;
                if (icon === undefined) break;
                await functionSettingsStep(
                    `setting icon for function ${importable.name}`,
                    () => setFunctionIconIfNeeded(ctx, icon)
                );
                break;
            }
            case "repeatTicks":
                await functionSettingsStep(
                    `setting automatic execution for function ${importable.name}`,
                    () =>
                        setAutomaticExecutionTicksIfNeeded(
                            ctx,
                            change.desired ?? 0
                        )
                );
                break;
            default: {
                const _exhaustiveCheck: never = change;
                return _exhaustiveCheck;
            }
        }
    }
}

export async function readFunctionSettings(
    ctx: TaskContext,
    name: string
): Promise<ObservedFunctionSettings> {
    const icon = functionIconFromSnapshot(await getSessionFunctionIcon(ctx, name));
    await openFunctionSettings(ctx, name);
    try {
        return {
            icon,
            description: readFunctionDescription(ctx),
            repeatTicks: readAutomaticExecutionTicks(ctx) ?? 0,
        };
    } finally {
        await clickGoBack(ctx);
    }
}
