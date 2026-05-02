import TaskContext from "../tasks/context";
import { exportFunction } from "./functions/export";
import { exportMenu } from "./menus/export";

export type ExportRequest =
    | {
          type: "FUNCTION";
          name: string;
          importJsonPath: string;
          htslPath: string;
          htslReference: string;
      }
    | {
          type: "MENU";
          name: string;
          importJsonPath: string;
          rootDir: string;
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
    if (request.type === "MENU") {
        await exportMenu(ctx, {
            name: request.name,
            importJsonPath: request.importJsonPath,
            rootDir: request.rootDir,
        });
        return;
    }
    // exhaustive
    const _check: never = request;
    void _check;
}
