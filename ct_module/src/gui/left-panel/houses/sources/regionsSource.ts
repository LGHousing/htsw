/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "@htsw/importer/tasks/manager";
import { getHousingUuid } from "@htsw/importer/runtime/state/index";
import { showToast } from "../../../toast";
import { listAllRegionNames } from "@htsw/importer/importables/regions/listRegions";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "@htsw/importer/importCache/cache";

let scanInFlight = false;

export function isRegionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseRegions(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "REGION");
}

export function houseRegionsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "REGION");
}

export function scanHouseRegions(): void {
    if (scanInFlight || TaskManager.isBusy()) return;
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
        showToast(`Region scan failed: ${String(err)}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Region scan failed: ${String(err)}`);
    });
}
