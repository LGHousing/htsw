import TaskContext from "../tasks/context";
import { readCurrentValue } from "../importer/helpers";
import { openFunctionEditor, tryGetFunctionNoteSlot } from "./helpers";
import { parseFunctionNote } from "./watermark";

export type ReadFunctionNoteResult = {
    exists: boolean;
    noteText: string | null;
    watermarkHash?: string;
    watermarkUpdatedAt?: string;
    malformedWatermark: boolean;
};

export async function readFunctionNote(
    ctx: TaskContext,
    functionName: string
): Promise<ReadFunctionNoteResult> {
    const exists = await openFunctionEditor(ctx, functionName);
    if (!exists) {
        return {
            exists: false,
            noteText: null,
            malformedWatermark: false,
        };
    }

    const noteSlot = tryGetFunctionNoteSlot(ctx);
    if (noteSlot == null) {
        return {
            exists: true,
            noteText: null,
            malformedWatermark: false,
        };
    }

    const noteText = readCurrentValue(noteSlot);
    const parsed = parseFunctionNote(noteText);

    return {
        exists: true,
        noteText: parsed.userNote,
        watermarkHash: parsed.payload?.hash,
        watermarkUpdatedAt: parsed.payload?.updatedAt,
        malformedWatermark: parsed.malformed,
    };
}
