/// <reference types="../../CTAutocomplete" />

import { TaskManager } from "../tasks/manager";
import { getHousingUuid } from "../gui/state";
import { showToast } from "../gui/toast";
import { listAllRegionNames } from "../importables/regions/listRegions";
import {
    getItems,
    isScanned,
    liveAdd,
    liveRemove,
    liveRename,
    markUnscanned,
    recordScan,
    type HouseItem,
} from "./store";

let scanInFlight = false;

export function isRegionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseRegions(uuid: string | null): HouseItem[] {
    return getItems(uuid, "REGION");
}

export function houseRegionsScanned(uuid: string | null): boolean {
    return isScanned(uuid, "REGION");
}

export function scanHouseRegions(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllRegionNames(ctx);
            recordScan(uuid, "REGION", names.map((n) => ({ name: n })));
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
        liveAdd(uuid, "REGION", m[1]);
        return;
    }
    m = msg.match(/^Deleted the region (.+)$/);
    if (m !== null) {
        liveRemove(uuid, "REGION", m[1]);
        return;
    }
    m = msg.match(/^Renamed region (.+) to (.+)$/);
    if (m !== null) {
        // A name containing " to " makes the split ambiguous; force a rescan.
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) {
            markUnscanned(uuid, "REGION");
        } else {
            liveRename(uuid, "REGION", m[1], m[2]);
        }
    }
});
