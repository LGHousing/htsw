/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllMenuNames } from "../../../../importables/menus/listMenus";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    writePresence,
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
        showToast(`Menu scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Menu scan failed: ${err}`);
    });
}

// Partial liveness: menus are keyed by title. Creation announces the title;
// deletion ("Deleted the custom menu") carries no title, so we can't patch a
// single entry — the next rescan reconciles it. Renames (Change Title) have no
// captured confirmation, so a retitle also needs a rescan.
register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    const created = msg.match(/^Created custom menu with the title (.+)!$/);
    if (created !== null) {
        writePresence(uuid, "MENU", created[1]);
    }
});
