/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { getNewExportTarget } from "../state";
import {
    getParseAt,
    markParseStale,
} from "../parsing/parses";
import type { ReadFn } from "../../importables/read";
import { exportProjectContextFromParsedImportJson } from "../../importables/exportContext";
import { TaskManager } from "../../tasks/manager";
import { closeAllPopovers } from "../lib/popovers";
import { shortPath } from "../lib/pathDisplay";
import { createExportProgressSink } from "./progressSink";
import { showToast } from "../toast";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { getExportDestinationStatus } from "./destinationStatus";

export type ExportSpec = {
    type: Importable["type"];
    label: string;
    read: ReadFn;
};

export function startExport(
    spec: ExportSpec,
    names?: readonly string[],
    onSuccess?: () => void,
    labels?: ReadonlyMap<string, string>
): void {
    closeAllPopovers();
    const destination = getExportDestinationStatus();
    if (destination.kind === "none") {
        showToast("Export stopped — choose or create an export project first", 0xffe85c5c, 8000);
        return;
    }
    if (destination.kind === "missing") {
        showToast("Export stopped — the selected project no longer exists", 0xffe85c5c, 8000);
        ChatLib.chat("&c[htsw] Export stopped: the selected project no longer exists.");
        ChatLib.chat(`&7  ${destination.path}`);
        ChatLib.chat("&7Choose another project from Houses → Export project.");
        return;
    }
    const importJsonPath = destination.path;
    if (names !== undefined && names.length === 0) {
        showToast("Nothing selected to export", 0xffe5bc4b);
        return;
    }
    if (TaskManager.isBusy()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }
    const dir = importJsonDir(importJsonPath);
    const count = names === undefined ? null : names.length;
    const newExportTarget = getNewExportTarget();
    runHousingSyncTask("export", (ctx) => {
        const exportContext = exportProjectContextFromParsedImportJson(
            { rootDir: dir, importJsonPath },
            getParseAt(importJsonPath)?.parsed
        );
        return spec.read(ctx, {
            ...exportContext,
            ...(newExportTarget !== null
                ? { newExportTargetImportJson: newExportTarget }
                : {}),
            names,
            progress: createExportProgressSink(spec.type, importJsonPath, "export", labels),
        });
    }).then((result) => {
        if (result === undefined) return;
        markParseStale(importJsonPath);
        if (result.failed > 0) {
            showToast(
                `Export finished with ${result.failed} failed, ${result.succeeded} ok → ${shortPath(importJsonPath)}`,
                0xffe85c5c,
                8000
            );
            return;
        }
        if (result.total === 0) {
            showToast(`No ${spec.label}s to export`, 0xffe5bc4b);
            return;
        }
        showToast(
            count === null
                ? `Exported all ${spec.label}s → ${shortPath(importJsonPath)}`
                : `Exported ${count} ${spec.label}${count === 1 ? "" : "s"} → ${shortPath(importJsonPath)}`,
            0xff5cb85c
        );
        if (onSuccess !== undefined) onSuccess();
    }).catch((err: unknown) => {
        showToast(`Export failed: ${err}`, 0xffe85c5c, 8000);
    });
}

function importJsonDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}
