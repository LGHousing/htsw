/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllFunctionEntries } from "../../../../importables/functions/listFunctions";
import {
    deleteImportableCache,
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    writePresence,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

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
