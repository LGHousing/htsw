/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllTeamNames } from "../../../../importables/teams/listTeams";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isTeamScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseTeams(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "TEAM");
}

export function houseTeamsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "TEAM");
}

export function scanHouseTeams(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const names = await listAllTeamNames(ctx);
            recordHouseScan(uuid, "TEAM", names);
            showToast(
                `Scanned ${names.length} team${names.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Team scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Team scan failed: ${err}`);
    });
}
