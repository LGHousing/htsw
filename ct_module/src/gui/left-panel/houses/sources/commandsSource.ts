/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllCommandNames } from "../../../../importables/commands/listCommands";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isCommandScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseCommands(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "COMMAND");
}

export function houseCommandsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "COMMAND");
}

export function scanHouseCommands(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllCommandNames(ctx);
            recordHouseScan(uuid, "COMMAND", names);
            showToast(
                `Scanned ${names.length} command${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Command scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Command scan failed: ${err}`);
    });
}
