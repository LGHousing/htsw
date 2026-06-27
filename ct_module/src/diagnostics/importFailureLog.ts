import {
    importDiagnosticStats,
    recentImportDiagnostics,
} from "./importDiagnosticsBuffer";
import { ensureParentDirs } from "../utils/filesystem";
import {
    describeGuiScreenMenu,
    menuStateDescription,
} from "../tasks/specifics/slots";
import {
    describeRecentWindowOpens,
    getEventContainerCounts,
} from "../tasks/specifics/waitFor";
import { uploadImportFailureLog } from "./importFailureUpload";

export type ImportFailureContext = {
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
        message: error instanceof Error ? error.message : String(error),
        stack: e.rhinoException?.getScriptStackTrace?.() ?? e.stack,
    };
}

function safeRead(label: string, read: () => unknown): unknown {
    try {
        return read();
    } catch (error) {
        return `<failed ${label}: ${error}>`;
    }
}

function timestampForPath(): string {
    const d = new Date();
    return d.toISOString().replace(/[:.]/g, "-");
}

export function writeImportFailureLog(
    context: ImportFailureContext,
    error: unknown
): string {
    const path = `./htsw/import-errors/import-error-${timestampForPath()}.json`;
    const body = {
        capturedAt: new Date().toISOString(),
        context,
        error: errorDetails(error),
        currentState: {
            menu: safeRead("menu", () => menuStateDescription()),
            gui: safeRead("gui", () => describeGuiScreenMenu()),
            waiters: safeRead("waiters", () => getEventContainerCounts()),
            recentWindowOpens: safeRead("window opens", () => describeRecentWindowOpens()),
        },
        diagnosticStats: importDiagnosticStats(),
        recent: recentImportDiagnostics(),
    };
    ensureParentDirs(path);
    FileLib.write(path, JSON.stringify(body, null, 2), true);
    uploadImportFailureLog(path);
    return path;
}
