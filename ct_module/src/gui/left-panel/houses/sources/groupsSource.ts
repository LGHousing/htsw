/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllGroupNames } from "../../../../importables/groups/listGroups";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isGroupScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseGroups(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "GROUP");
}

export function houseGroupsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "GROUP");
}

export function scanHouseGroups(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllGroupNames(ctx);
            recordHouseScan(uuid, "GROUP", names);
            showToast(
                `Scanned ${names.length} group${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Group scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Group scan failed: ${err}`);
    });
}
