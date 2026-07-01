import TaskContext from "../tasks/context";
import { traceError, traceRecord } from "../housingSync/trace/taskTrace";
import { exportCommand } from "./commands/export";
import { exportFunction } from "./functions/export";
import { exportMenu } from "./menus/export";
import { exportNpc } from "./npcs/export";
import { exportRegion } from "./regions/export";

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
          type: "COMMAND";
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
      }
    | {
          type: "REGION";
          name: string;
          importJsonPath: string;
          rootDir: string;
      }
    | {
          type: "NPC";
          name: string;
          pos: { x: number; y: number; z: number };
          importJsonPath: string;
          rootDir: string;
      };

export async function exportImportable(
    ctx: TaskContext,
    request: ExportRequest
): Promise<void> {
    traceRecord("exportImportable", {
        stage: "start",
        type: request.type,
        name: request.name,
        importJsonPath: request.importJsonPath,
        rootDir: request.rootDir,
    });

    try {
        switch (request.type) {
            case "FUNCTION":
                await exportFunction(ctx, {
                    name: request.name,
                    importJsonPath: request.importJsonPath,
                    declaringJsonPath: request.declaringJsonPath,
                    htslPath: request.htslPath,
                    htslReference: request.htslReference,
                    rootDir: request.rootDir,
                });
                break;
            case "COMMAND":
                await exportCommand(ctx, {
                    name: request.name,
                    importJsonPath: request.importJsonPath,
                    declaringJsonPath: request.declaringJsonPath,
                    htslPath: request.htslPath,
                    htslReference: request.htslReference,
                    rootDir: request.rootDir,
                });
                break;
            case "MENU":
                await exportMenu(ctx, {
                    name: request.name,
                    importJsonPath: request.importJsonPath,
                    rootDir: request.rootDir,
                });
                break;
            case "REGION":
                await exportRegion(ctx, {
                    name: request.name,
                    importJsonPath: request.importJsonPath,
                    rootDir: request.rootDir,
                });
                break;
            case "NPC":
                await exportNpc(ctx, {
                    name: request.name,
                    pos: request.pos,
                    importJsonPath: request.importJsonPath,
                    rootDir: request.rootDir,
                });
                break;
            default: {
                const _check: never = request;
                void _check;
            }
        }
        traceRecord("exportImportable", {
            stage: "success",
            type: request.type,
            name: request.name,
        });
    } catch (error) {
        traceError("exportImportable", error, {
            type: request.type,
            name: request.name,
        });
        throw error;
    }
}
