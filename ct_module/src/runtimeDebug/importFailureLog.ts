import { recentRuntimeDebugRecords, runtimeDebugStats } from "./runtimeDebugBuffer";
import { ensureParentDirs } from "../utils/filesystem";
import {
    describeGuiScreenMenu,
    menuItemDebugSnapshot,
    menuStateDescription,
} from "../tasks/specifics/slots";
import {
    describeRecentWindowOpens,
    getEventContainerCounts,
} from "../tasks/specifics/waitFor";
import { uploadDiagnosticsFile } from "./importFailureUpload";
import { readLocalVersion } from "../autoUpdate";

export type TaskFailureDetails = {
    phase: string;
    sourcePath: string;
    housingUuid: string;
    importableType?: string;
    identity?: string;
    rowIndex?: number;
};

function errorDetails(error: unknown): Record<string, unknown> {
    const e = error as {
        message?: string;
        stack?: string;
        rhinoException?: { getScriptStackTrace?: () => string };
    };
    return {
        message: error instanceof Error ? error.message : stringifyUnknown(error),
        stack: e.rhinoException?.getScriptStackTrace?.() ?? e.stack,
    };
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        const json: unknown = JSON.stringify(value);
        if (typeof json === "string") return json;
    } catch (_e) {}
    return String(value);
}

function safeRead(label: string, read: () => unknown): unknown {
    try {
        return read();
    } catch (error) {
        return `<failed ${label}: ${stringifyUnknown(error)}>`;
    }
}

function timestampForPath(): string {
    const d = new Date();
    return d.toISOString().replace(/[:.]/g, "-");
}

export function writeTaskFailureLog(
    context: TaskFailureDetails,
    error: unknown
): string {
    const path = `./htsw/import-errors/import-error-${timestampForPath()}.json`;
    const body = {
        capturedAt: new Date().toISOString(),
        htswVersion: safeRead("version", () => readLocalVersion()),
        context,
        error: errorDetails(error),
        currentState: {
            menu: safeRead("menu", () => menuStateDescription()),
            menuItems: safeRead("menu items", () => menuItemDebugSnapshot()),
            gui: safeRead("gui", () => describeGuiScreenMenu()),
            waiters: safeRead("waiters", () => getEventContainerCounts()),
            recentWindowOpens: safeRead("window opens", () =>
                describeRecentWindowOpens()
            ),
        },
        runtimeDebugStats: runtimeDebugStats(),
        recentRuntimeDebug: recentRuntimeDebugRecords(),
    };
    ensureParentDirs(path);
    FileLib.write(path, JSON.stringify(body, null, 2), true);
    uploadDiagnosticsFile(path, { chatUploadedId: true });
    return path;
}
