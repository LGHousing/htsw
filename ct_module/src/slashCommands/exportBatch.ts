import type TaskContext from "../tasks/context";
import { exportExisting as exportExistingShared } from "../importables/export/session";
import type { ExportDestination } from "./exportDestination";

export {
    exportBatch,
    notYetExportedFunctionNames,
    type ExportBatchType,
    type NamedExportType,
} from "../importables/export/session";

export async function exportExisting(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    await exportExistingShared(ctx, destination);
}
