/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { markGuiDirty } from "../../../lib/dirty";
import { listAllGroupEntries } from "../../../../importables/groups/listGroups";
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
    if (scanInFlight || TaskManager.isBusy()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllGroupEntries(ctx);
            const colors = new Map(entries.map((entry) => [entry.name, entry.color]));
            recordHouseScan(
                uuid,
                "GROUP",
                entries.map((entry) => entry.name),
                undefined,
                undefined,
                colors
            );
            markGuiDirty();
            showToast(
                `Scanned ${entries.length} group${entries.length === 1 ? "" : "s"}`,
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
