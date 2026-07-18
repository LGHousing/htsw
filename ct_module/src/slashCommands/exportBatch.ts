import type TaskContext from "../tasks/context";
import { exportExisting as exportExistingShared } from "../importables/exportBatch";
import type { ExportDestination } from "./exportDestination";

export {
    exportBatch,
    notYetExportedFunctionNames,
    type ExportBatchType,
    type NamedExportType,
} from "../importables/exportBatch";

export async function exportExisting(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    await exportExistingShared(ctx, destination);
}
