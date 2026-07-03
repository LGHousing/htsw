/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { getExportImportJsonPath } from "../state";
import {
    getParseAt,
    markParseStale,
} from "../parsing/parses";
import type { ReadFn, ReadResult } from "../../importables/read";
import { exportProjectContextFromParsedImportJson } from "../../importables/exportContext";
import { TaskManager } from "../../tasks/manager";
import { closeAllPopovers } from "../lib/popovers";
import { shortPath } from "../lib/pathDisplay";
import { createExportProgressSink } from "./progressSink";
import { showToast } from "../toast";
import { isTaskRunning, setTaskRunning } from "../../tasks/runningState";
import { resetEventContainers } from "../../tasks/specifics/waitFor";
import {
    clearActiveTaskContext,
    setActiveTaskContext,
} from "../../tasks/activeTask";

export type ExportSpec = {
    type: Importable["type"];
    label: string;
    read: ReadFn;
};

export function startExport(
    spec: ExportSpec,
    names?: readonly string[],
    onSuccess?: () => void
): void {
    closeAllPopovers();
    const importJsonPath = getExportImportJsonPath();
    if (importJsonPath.trim() === "") {
        showToast("No import.json loaded — pick a destination first", 0xffe85c5c);
        return;
    }
    if (names !== undefined && names.length === 0) {
        showToast("Nothing selected to export", 0xffe5bc4b);
        return;
    }
    if (isTaskRunning() || TaskManager.hasRunningTasks()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }
    const dir = importJsonDir(importJsonPath);
    const count = names === undefined ? null : names.length;
    TaskManager.run(async (ctx) => {
        setActiveTaskContext("export", ctx);
        setTaskRunning(true);
        let result: ReadResult;
        try {
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
            }
            const exportContext = exportProjectContextFromParsedImportJson(
                { rootDir: dir, importJsonPath },
                getParseAt(importJsonPath)?.parsed
            );
            result = await spec.read(ctx, {
                ...exportContext,
                names,
                progress: createExportProgressSink(spec.type, importJsonPath),
            });
        } finally {
            clearActiveTaskContext("export", ctx);
            setTaskRunning(false);
        }
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
