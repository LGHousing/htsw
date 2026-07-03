/// <reference types="../../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { TaskManager } from "../../../../tasks/manager";
import { setTaskRunning } from "../../../../tasks/runningState";
import { getExportImportJsonPath, getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { createExportProgressSink } from "../../../export/progressSink";
import { exportProjectContextFromParsedImportJson } from "../../../../importables/exportContext";
import { getParseAt } from "../../../parsing/parses";
import { resetEventContainers } from "../../../../tasks/specifics/waitFor";
import {
    clearActiveTaskContext,
    setActiveTaskContext,
} from "../../../../tasks/activeTask";
import { recordHouseScan } from "../../../../importCache/cache";
import type { ReadFn, ReadResult } from "../../../../importables/read";

// Shared across all content types: starting any deep read blocks starting
// another until it settles.
let readInFlight = false;

// Builds a `deepRead(onlyNames?)` for one content type: the export driver in
// read-only mode, caching live house contents instead of writing files.
// `onlyNames` limits the pass to a selection; omitted reads the whole house.
export function makeDeepRead(
    type: Importable["type"],
    label: string,
    read: ReadFn,
    isScanning: () => boolean
): (onlyNames?: string[]) => void {
    return (onlyNames?: string[]): void => {
        if (readInFlight || isScanning() || TaskManager.hasRunningTasks()) return;
        const uuid = getHousingUuid();
        if (uuid === null) return;
        const importJsonPath = getExportImportJsonPath();
        if (importJsonPath.trim() === "") {
            showToast("No import.json loaded — pick a destination first", 0xffe85c5c);
            return;
        }
        readInFlight = true;
        TaskManager.run(async (ctx) => {
            setActiveTaskContext("export", ctx);
            setTaskRunning(true);
            let result: ReadResult;
            try {
                const purged = resetEventContainers();
                if (purged > 0) {
                    ChatLib.chat(
                        `&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`
                    );
                }
                const exportContext = exportProjectContextFromParsedImportJson(
                    { rootDir: "", importJsonPath },
                    getParseAt(importJsonPath)?.parsed
                );
                result = await read(ctx, {
                    ...exportContext,
                    names: onlyNames,
                    readOnly: { housingUuid: uuid },
                    onNamesListed: (names) =>
                        recordHouseScan(uuid, type, names.slice()),
                    progress: createExportProgressSink(type, importJsonPath, "read"),
                });
            } finally {
                clearActiveTaskContext("export", ctx);
                setTaskRunning(false);
                readInFlight = false;
            }
            if (result.failed > 0) {
                showToast(
                    `Read ${result.succeeded} of ${result.total} ${label}${result.total === 1 ? "" : "s"} (${result.failed} failed)`,
                    0xffe85c5c,
                    8000
                );
            } else {
                showToast(
                    `Read ${result.succeeded} ${label}${result.succeeded === 1 ? "" : "s"}`,
                    0xff5cb85c
                );
            }
        }).catch((err: unknown) => {
            showToast(`${label} read failed: ${err}`, 0xffe85c5c, 8000);
            ChatLib.chat(`&c[htsw] ${label} read failed: ${err}`);
        });
    };
}
