/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { markGuiDirty } from "../../../lib/dirty";
import { listAllTeamEntries } from "../../../../importables/teams/listTeams";
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
    if (scanInFlight || TaskManager.isBusy()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllTeamEntries(ctx);
            const colors = new Map(entries.map((entry) => [entry.name, entry.color]));
            recordHouseScan(
                uuid,
                "TEAM",
                entries.map((entry) => entry.name),
                undefined,
                undefined,
                colors
            );
            markGuiDirty();
            showToast(
                `Scanned ${entries.length} team${entries.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Team scan failed: ${String(err)}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Team scan failed: ${String(err)}`);
    });
}
