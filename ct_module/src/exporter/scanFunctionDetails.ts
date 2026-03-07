import TaskContext from "../tasks/context";
import { readActionList } from "./actions";
import { openFunctionEditor } from "./helpers";
import { readFunctionNote, type ReadFunctionNoteResult } from "./readFunctionNote";
import type { ScannedFunction, WatermarkPayload } from "./types";

function toWatermark(
    noteResult: Pick<ReadFunctionNoteResult, "watermarkHash" | "watermarkUpdatedAt">
): WatermarkPayload | undefined {
    if (!noteResult.watermarkHash || !noteResult.watermarkUpdatedAt) {
        return undefined;
    }
    return {
        hash: noteResult.watermarkHash,
        updatedAt: noteResult.watermarkUpdatedAt,
    };
}

export type ScanFunctionDetailsDeps = {
    readFunctionNote: typeof readFunctionNote;
    openFunctionEditor: typeof openFunctionEditor;
    readActionList: typeof readActionList;
};

export const SCAN_FUNCTION_DETAILS_DEPS: ScanFunctionDetailsDeps = {
    readFunctionNote,
    openFunctionEditor,
    readActionList,
};

export async function scanFunctionDetails(
    ctx: TaskContext,
    functionName: string,
    repeatTicks?: number
): Promise<ScannedFunction> {
    const deps = SCAN_FUNCTION_DETAILS_DEPS;

    const noteResult = await deps.readFunctionNote(ctx, functionName);
    if (!noteResult.exists) {
        return {
            name: functionName,
            repeatTicks,
            scanError: "Function does not exist in house",
        };
    }

    const watermark = toWatermark(noteResult);
    const opened = await deps.openFunctionEditor(ctx, functionName);
    if (!opened) {
        return {
            name: functionName,
            repeatTicks,
            watermark,
            scanError: "Failed to open function editor",
        };
    }

    try {
        const actions = await deps.readActionList(ctx);
        return {
            name: functionName,
            repeatTicks,
            actions,
            watermark,
        };
    } catch (e) {
        return {
            name: functionName,
            repeatTicks,
            watermark,
            scanError: `${e}`,
        };
    }
}
