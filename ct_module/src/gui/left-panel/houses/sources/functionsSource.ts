/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { setImportRunning } from "../../../../housingSync/runtimeState";
import { getExportImportJsonPath, getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { createExportProgressSink } from "../../../right-panel/import-tab/exportProgress";
import type { ExportProgressSink } from "../../../../housingSync/progress/types";
import {
    listAllFunctionEntries,
    listAllFunctionNames,
    resetFunctionNameSession,
} from "../../../../importables/functions/listFunctions";
import { readFunctionImportable } from "../../../../importables/functions/export";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../../../housingSync/itemCapture";
import {
    deleteImportableCache,
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    writeImportableCache,
    writePresence,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;
let readInFlight = false;

export function isFunctionScanInFlight(): boolean {
    return scanInFlight;
}

export function isFunctionReadInFlight(): boolean {
    return readInFlight;
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
 * Deep read: open every function in the house, read its full AST, and cache it
 * as verified content — no import.json/.htsl written. This is the read-only
 * "update knowledge" pass; it's slow (one editor open per function), so it's an
 * explicit action, not part of the cheap names scan.
 */
export function deepReadHouseFunctions(): void {
    if (readInFlight || scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    readInFlight = true;
    TaskManager.run(async (ctx) => {
        // Drop any stale function-list snapshot so icon reads reflect the live
        // house, matching the exporter.
        resetFunctionNameSession();
        const snapshot: InventorySnapshot = snapshotInventory();
        let read = 0;
        let progress: ExportProgressSink | null = null;
        setImportRunning(true);
        try {
            const names = await listAllFunctionNames(ctx);
            recordHouseScan(uuid, "FUNCTION", names);
            // Same strip the importer/exporter use, verb "read" — a deep read
            // opens every function editor, far too slow to run dark.
            progress = createExportProgressSink("FUNCTION", getExportImportJsonPath(), "read");
            progress.start(names);
            for (let i = 0; i < names.length; i++) {
                progress.item(i, names[i]);
                const sink = progress;
                try {
                    const itemCaptures = new ItemCaptureRegistry();
                    const imp = await readFunctionImportable(
                        ctx,
                        names[i],
                        itemCaptures,
                        sink.itemProgress === undefined
                            ? undefined
                            : (payload) => sink.itemProgress!(i, payload)
                    );
                    if (itemCaptures.size() > 0) {
                        deleteImportableCache(uuid, "FUNCTION", names[i]);
                        writePresence(uuid, "FUNCTION", names[i]);
                    } else {
                        writeImportableCache(ctx, uuid, imp, "reader", true);
                    }
                    read++;
                } catch (err) {
                    // The run aborts on the first failure; without this the
                    // `done()` in the finally would close the row as imported.
                    sink.itemFailed?.(i, String(err));
                    throw err;
                }
            }
        } finally {
            setImportRunning(false);
            if (progress !== null) progress.done();
            try {
                await restoreInventoryToSnapshot(ctx, snapshot);
            } catch (_e) {
                /* ignore */
            }
            readInFlight = false;
        }
        showToast(`Read ${read} function${read === 1 ? "" : "s"}`, 0xff5cb85c);
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
