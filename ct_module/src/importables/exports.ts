import TaskContext from "../tasks/context";
import { traceError, traceRecord } from "../housingSync/trace/importTrace";
import { exportCommand } from "./commands/export";
import { exportFunction } from "./functions/export";
import { exportMenu } from "./menus/export";
import { exportNpc } from "./npcs/export";
import { exportRegion } from "./regions/export";

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
    if (request.type === "FUNCTION") {
        try {
            await exportFunction(ctx, {
                name: request.name,
                importJsonPath: request.importJsonPath,
                declaringJsonPath: request.declaringJsonPath,
                htslPath: request.htslPath,
                htslReference: request.htslReference,
                rootDir: request.rootDir,
            });
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
        return;
    }
    if (request.type === "COMMAND") {
        try {
            await exportCommand(ctx, {
                name: request.name,
                importJsonPath: request.importJsonPath,
                declaringJsonPath: request.declaringJsonPath,
                htslPath: request.htslPath,
                htslReference: request.htslReference,
                rootDir: request.rootDir,
            });
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
        return;
    }
    if (request.type === "MENU") {
        try {
            await exportMenu(ctx, {
                name: request.name,
                importJsonPath: request.importJsonPath,
                rootDir: request.rootDir,
            });
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
        return;
    }
    if (request.type === "REGION") {
        try {
            await exportRegion(ctx, {
                name: request.name,
                importJsonPath: request.importJsonPath,
                rootDir: request.rootDir,
            });
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
        return;
    }
    if (request.type === "NPC") {
        try {
            await exportNpc(ctx, {
                name: request.name,
                pos: request.pos,
                importJsonPath: request.importJsonPath,
                rootDir: request.rootDir,
            });
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
        return;
    }
    const _check: never = request;
    void _check;
}
