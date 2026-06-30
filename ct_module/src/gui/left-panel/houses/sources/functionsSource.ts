/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { setImportRunning } from "../../../../housingSync/importRunState";
import { getExportImportJsonPath, getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { createExportProgressSink } from "../../../right-panel/import-tab/exportProgress";
import { listAllFunctionEntries } from "../../../../importables/functions/listFunctions";
import { exportAllFunctions } from "../../../../importables/functions/exportAll";
import { getParseAt } from "../../../parsing/parses";
import type { ImportableItem } from "htsw/types";
import { resetEventContainers } from "../../../../tasks/specifics/waitFor";
import {
    deleteImportableCache,
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    writePresence,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;
let readInFlight = false;

export function isFunctionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseFunctions(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "FUNCTION");
}

export function houseFunctionsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "FUNCTION");
}

export function scanHouseFunctions(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllFunctionEntries(ctx);
            recordHouseScan(uuid, "FUNCTION", entries.map((e) => e.name));
            showToast(
                `Scanned ${entries.length} function${entries.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Function scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Function scan failed: ${err}`);
    });
}

/**
 * Deep read: the export driver in read-only mode — same editor walk, but the
 * results go only into this house's knowledge cache, no files written. Slow
 * (one editor open per function), so it's an explicit action, not part of the
 * cheap names scan. With `onlyNames` it reads just those functions
 * (selection-driven); without, it scans and reads the whole house.
 */
export function deepReadHouseFunctions(onlyNames?: string[]): void {
    if (readInFlight || scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    readInFlight = true;
    TaskManager.run(async (ctx) => {
        setImportRunning(true);
        // Boundary purge, mirroring import/export: leaked waiters from a prior
        // failed run re-run per packet and jitter input until purged.
        const purged = resetEventContainers();
        if (purged > 0) {
            ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
        }
        let result;
        try {
            const destParse = getParseAt(getExportImportJsonPath());
            result = await exportAllFunctions(ctx, {
                importJsonPath: getExportImportJsonPath(),
                rootDir: "",
                names: onlyNames,
                readOnly: { housingUuid: uuid },
                // Seeded matching lets read knowledge reference REAL project
                // item names when contents are identical.
                projectItems:
                    destParse?.parsed?.value.filter(
                        (imp): imp is ImportableItem => imp.type === "ITEM"
                    ) ?? [],
                onNamesListed: (names) =>
                    recordHouseScan(uuid, "FUNCTION", names.slice()),
                // Same strip the importer/exporter use, verb "read" — a deep
                // read opens every function editor, far too slow to run dark.
                progress: createExportProgressSink(
                    "FUNCTION",
                    getExportImportJsonPath(),
                    "read"
                ),
            });
        } finally {
            setImportRunning(false);
            readInFlight = false;
        }
        if (result.failed > 0) {
            showToast(
                `Read ${result.succeeded} of ${result.total} function${result.total === 1 ? "" : "s"} (${result.failed} failed)`,
                0xffe85c5c,
                8000
            );
        } else {
            showToast(
                `Read ${result.succeeded} function${result.succeeded === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        }
    }).catch((err: unknown) => {
        showToast(`Function read failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Function read failed: ${err}`);
    });
}

// Liveness: Hypixel announces create/delete/rename in chat. Only the house we're
// standing in can change, so every mutation targets the current UUID.
register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    let m = msg.match(/^Created function (.+)!$/);
    if (m !== null) {
        writePresence(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Deleted the function (.+)$/);
    if (m !== null) {
        deleteImportableCache(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Renamed function (.+) to (.+)$/);
    if (m !== null) {
        // A name containing " to " makes the split ambiguous; leave it for a
        // rescan rather than trust the heuristic.
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) return;
        deleteImportableCache(uuid, "FUNCTION", m[1]);
        writePresence(uuid, "FUNCTION", m[2]);
    }
});
