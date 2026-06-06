/// <reference types="../../CTAutocomplete" />

import { TaskManager } from "../tasks/manager";
import { getHousingUuid } from "../gui/state";
import { showToast } from "../gui/toast";
import { listAllMenuNames } from "../importables/menus/listMenus";
import {
    getItems,
    isScanned,
    liveAdd,
    markUnscanned,
    recordScan,
    type HouseItem,
} from "./store";

let scanInFlight = false;

export function isMenuScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseMenus(uuid: string | null): HouseItem[] {
    return getItems(uuid, "MENU");
}

export function houseMenusScanned(uuid: string | null): boolean {
    return isScanned(uuid, "MENU");
}

export function scanHouseMenus(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllMenuNames(ctx);
            recordScan(uuid, "MENU", names.map((n) => ({ name: n })));
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

// Partial liveness: menus are keyed by title. Creation announces the title so we
// can add it live; the delete confirmation ("Deleted the custom menu") carries
// no title, so we can't patch a single entry — invalidate the scan instead of
// keeping a phantom. Renames (Change Title) have no captured confirmation, so a
// retitle also needs a rescan.
register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    const created = msg.match(/^Created custom menu with the title (.+)!$/);
    if (created !== null) {
        liveAdd(uuid, "MENU", created[1]);
        return;
    }
    if (msg === "Deleted the custom menu") {
        markUnscanned(uuid, "MENU");
    }
});
