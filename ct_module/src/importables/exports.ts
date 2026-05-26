import TaskContext from "../tasks/context";
import { exportFunction } from "./functions/export";
import { exportAllFunctions } from "./functions/exportAll";
import { exportAllEvents } from "./events/exportAll";
import { exportMenu } from "./menus/export";

export type ExportRequest =
    | {
          type: "FUNCTION";
          name: string;
          importJsonPath: string;
          htslPath: string;
          htslReference: string;
          rootDir: string;
      }
    | {
          type: "MENU";
          name: string;
          importJsonPath: string;
          rootDir: string;
      }
    | {
          type: "ALL_FUNCTIONS";
          importJsonPath: string;
          rootDir: string;
          /** If set, export exactly these names instead of walking Housing's function list. */
          names?: readonly string[];
      }
    | {
          type: "ALL_EVENTS";
          importJsonPath: string;
          rootDir: string;
          /** If set, export exactly these event names instead of walking Housing's `/eventactions` menu. */
          names?: readonly string[];
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
            rootDir: request.rootDir,
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
    if (request.type === "ALL_FUNCTIONS") {
        await exportAllFunctions(ctx, {
            importJsonPath: request.importJsonPath,
            rootDir: request.rootDir,
            ...(request.names !== undefined ? { names: request.names } : {}),
        });
        return;
    }
    if (request.type === "ALL_EVENTS") {
        await exportAllEvents(ctx, {
            importJsonPath: request.importJsonPath,
            rootDir: request.rootDir,
            ...(request.names !== undefined ? { names: request.names } : {}),
        });
        return;
    }
    // exhaustive
    const _check: never = request;
    void _check;
}
