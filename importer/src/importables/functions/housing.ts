import { IncompleteReadError } from "../../housingSync/incompleteRead";
import { submitHousingText } from "../../housingSync/menus/textInput";
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
import { errorMessage, removedFormatting, unique } from "../../utils/helpers";
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

    await submitHousingText(
        ctx,
        "Function name",
        name,
        (onSent) => ctx.runCommand(`/function create ${name}`, onSent),
        () => ctx.withTimeout(
            functionActionEditorOpened(name).start(ctx),
            "Waiting for function creation",
            8000
        )
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
        await submitHousingText(
            ctx,
            "Function name",
            name,
            (onSent) => ctx.runCommand(`/function create ${name}`, onSent),
            () => ctx.withTimeout(
                functionActionEditorOpened(name).start(ctx),
                "Waiting for function creation",
                8000
            )
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

function readAutomaticExecutionTicks(ctx: TaskContext): number {
    const item = ctx.getItemSlot("Automatic Execution").getItem();
    return parseAutomaticExecutionTicks(itemLore(item), item.getName());
}

export function parseAutomaticExecutionTicks(
    lore: readonly string[],
    rawName = "Automatic Execution"
): number {
    for (const line of lore) {
        const kv = parseLoreKeyValueLine(line);
        if (!kv || kv.label !== "Current") continue;
        const value = removedFormatting(kv.value).trim();
        if (value === "Disabled") return 0;
        // Housing shows "18000 Ticks (15m00s)"; the bracketed duration repeats the same interval.
        const ticks = /^(\d+)(?:\s+Ticks?(?:\s+\([^()]*\))?)?$/i.exec(value)?.[1];
        if (ticks !== undefined && Number.isSafeInteger(Number(ticks))) return Number(ticks);
        break;
    }
    // Escape section signs so Minecraft displays the codes instead of consuming
    // them as formatting. Keep the captured item details bounded in failure logs.
    const details = JSON.stringify({
        name: rawName.trim(),
        lore: lore.map((line) => line.trim()),
    }).replace(/§/g, "\\u00a7");
    const boundedDetails = details.length > 300 ? details.slice(0, 299) + "…" : details;
    throw new Error(
        "Could not read the function's automatic execution interval. " + boundedDetails
    );
}

export async function readFunctionRepeatTicks(
    ctx: TaskContext,
    name: string
): Promise<number> {
    await openFunctionSettings(ctx, name);
    try {
        return readAutomaticExecutionTicks(ctx);
    } finally {
        await clickGoBack(ctx);
    }
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
    const currentTicks = readAutomaticExecutionTicks(ctx);
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
        if (error instanceof IncompleteReadError) throw error.withContext(label);
        const message = errorMessage(error);
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
            repeatTicks: readAutomaticExecutionTicks(ctx),
        };
    } finally {
        await clickGoBack(ctx);
    }
}
