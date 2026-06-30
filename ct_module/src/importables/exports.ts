import TaskContext from "../tasks/context";
import { exportFunction } from "./functions/export";
import { exportMenu } from "./menus/export";

export type ExportResult = { total: number; succeeded: number; failed: number };

export type ExportRequest =
    | {
          type: "FUNCTION";
          name: string;
          importJsonPath: string;
          declaringJsonPath?: string;
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
            declaringJsonPath: request.declaringJsonPath,
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
