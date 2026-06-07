/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllRegionNames } from "../../../../importables/regions/listRegions";
import {
    deleteImportableCache,
    listCachedImportables,
    recordHouseScan,
    writePresence,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isRegionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseRegions(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "REGION");
}

export function houseRegionsScanned(uuid: string | null): boolean {
    return listCachedImportables(uuid, "REGION").length > 0;
}

export function scanHouseRegions(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllRegionNames(ctx);
            recordHouseScan(uuid, "REGION", names);
            showToast(
                `Scanned ${names.length} region${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Region scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Region scan failed: ${err}`);
    });
}

// Liveness: regions announce create/delete/rename in chat, all carrying names.
register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    let m = msg.match(/^Created region (.+)!$/);
    if (m !== null) {
        writePresence(uuid, "REGION", m[1]);
        return;
    }
    m = msg.match(/^Deleted the region (.+)$/);
    if (m !== null) {
        deleteImportableCache(uuid, "REGION", m[1]);
        return;
    }
    m = msg.match(/^Renamed region (.+) to (.+)$/);
    if (m !== null) {
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) return;
        deleteImportableCache(uuid, "REGION", m[1]);
        writePresence(uuid, "REGION", m[2]);
    }
});
