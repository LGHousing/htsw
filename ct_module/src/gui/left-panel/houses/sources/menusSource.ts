/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../../runtime/state/index";
import { showToast } from "../../../toast";
import { listAllMenuNames } from "../../../../importables/menus/listMenus";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isMenuScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseMenus(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "MENU");
}

export function houseMenusScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "MENU");
}

export function scanHouseMenus(): void {
    if (scanInFlight || TaskManager.isBusy()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllMenuNames(ctx);
            recordHouseScan(uuid, "MENU", names);
            showToast(
                `Scanned ${names.length} menu${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Menu scan failed: ${String(err)}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Menu scan failed: ${String(err)}`);
    });
}
