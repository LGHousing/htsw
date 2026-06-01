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
          rootDir: string;
      }
    | {
          type: "MENU";
          name: string;
          importJsonPath: string;
          rootDir: string;
      };

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
    const _check: never = request;
    void _check;
}
