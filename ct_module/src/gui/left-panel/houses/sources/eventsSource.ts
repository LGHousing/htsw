/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllEventNames } from "../../../../importables/events/listEvents";
import { listCachedImportables, recordHouseScan, type HouseImportable } from "../../../../importCache/cache";

// Housing events are a fixed enumerated set (player join, etc.) — they aren't
// created/deleted, so there's no liveness channel here; the list refreshes on
// rescan only.
let scanInFlight = false;

export function isEventScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseEvents(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "EVENT");
}

export function houseEventsScanned(uuid: string | null): boolean {
    return listCachedImportables(uuid, "EVENT").length > 0;
}

export function scanHouseEvents(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllEventNames(ctx);
            recordHouseScan(uuid, "EVENT", names);
            showToast(
                `Scanned ${names.length} event${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Event scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Event scan failed: ${err}`);
    });
}
