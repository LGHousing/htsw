import TaskContext from "../tasks/context";
import { exportFunction } from "../exporter/exportFunction";

/**
 * Discriminated union over the importable types the exporter knows how
 * to produce. v1 only handles functions; the others will be added
 * incrementally and will reuse the same dispatch shape.
 */
export type ExportRequest =
    | {
          type: "FUNCTION";
          name: string;
          importJsonPath: string;
          htslPath: string;
          htslReference: string;
      };

/**
 * Single entry point for the exporter. Mirrors the importer's
 * `importImportable(...)` pattern so the command layer doesn't have to
 * know which subsystem implements which type.
 */
export async function exportImportable(
    ctx: TaskContext,
    request: ExportRequest
): Promise<void> {
    if (request.type === "FUNCTION") {
        await exportFunction(ctx, {
            name: request.name,
            importJsonPath: request.importJsonPath,
            htslPath: request.htslPath,
            htslReference: request.htslReference,
        });
        return;
    }
    // exhaustive
    const _check: never = request.type;
    void _check;
}
