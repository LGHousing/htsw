/// <reference types="../../CTAutocomplete" />

import { TaskManager } from "../tasks/manager";
import { getHousingUuid } from "../gui/state";
import { showToast } from "../gui/toast";
import { listAllEventNames } from "../importables/events/listEvents";
import { getItems, isScanned, recordScan, type HouseItem } from "./store";

// Housing events are a fixed enumerated set (player join, etc.) — they aren't
// created/deleted, so there's no liveness channel here; the list refreshes on
// rescan only.
let scanInFlight = false;

export function isEventScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseEvents(uuid: string | null): HouseItem[] {
    return getItems(uuid, "EVENT");
}

export function houseEventsScanned(uuid: string | null): boolean {
    return isScanned(uuid, "EVENT");
}

export function scanHouseEvents(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllEventNames(ctx);
            recordScan(uuid, "EVENT", names.map((n) => ({ name: n })));
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
