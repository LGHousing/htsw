import TaskContext from "../tasks/context";
import { setStringValue, waitForMenuToLoad, readCurrentValue } from "../importer/helpers";
import { tryGetFunctionNoteSlot } from "./helpers";
import { applyFunctionWatermark } from "./watermark";
import type { WatermarkPayload } from "./types";

export async function writeFunctionWatermarkOnOpenEditor(
    ctx: TaskContext,
    payload: WatermarkPayload
): Promise<{ ok: boolean; reason?: string }> {
    const noteSlot = tryGetFunctionNoteSlot(ctx);
    if (noteSlot == null) {
        return { ok: false, reason: "Function note slot was not found" };
    }

    const currentValue = readCurrentValue(noteSlot);
    const nextValue = applyFunctionWatermark(currentValue, payload);

    await setStringValue(ctx, noteSlot, nextValue);
    await waitForMenuToLoad(ctx);

    return { ok: true };
}
