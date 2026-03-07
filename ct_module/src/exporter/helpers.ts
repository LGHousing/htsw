import TaskContext from "../tasks/context";
import { removedFormatting } from "../helpers";
import { readCurrentValue, waitForMenuToLoad } from "../importer/helpers";

const FUNCTION_NOTE_SLOT_CANDIDATES = [
    "Function Note",
    "Function Notes",
    "Note",
];

const FUNCTION_NOT_FOUND_MESSAGE = "Could not find a function with that name!";

export async function openFunctionEditor(
    ctx: TaskContext,
    functionName: string
): Promise<boolean> {
    ctx.runCommand(`/function edit ${functionName}`);

    return ctx.withTimeout(
        Promise.race([
            waitForMenuToLoad(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) === FUNCTION_NOT_FOUND_MESSAGE
                )
                .then(() => false),
        ]),
        "Waiting for function to open"
    );
}

export function tryGetFunctionNoteSlot(ctx: TaskContext) {
    for (const slotName of FUNCTION_NOTE_SLOT_CANDIDATES) {
        const slot = ctx.tryGetItemSlot(slotName);
        if (slot != null) return slot;
    }
    return null;
}

export function readNormalizedFieldValue(
    ctx: TaskContext,
    slotNames: string[]
): string | undefined {
    for (const slotName of slotNames) {
        const slot = ctx.tryGetItemSlot(slotName);
        if (slot == null) continue;
        const value = readCurrentValue(slot);
        if (value == null) continue;
        const normalized = removedFormatting(value).trim();
        if (normalized.length > 0) return normalized;
    }
    return undefined;
}
