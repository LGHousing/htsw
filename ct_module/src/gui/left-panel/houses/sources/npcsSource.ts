/// <reference types="../../../../../CTAutocomplete" />

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { listAllNpcs } from "../../../../importables/npcs/listNpcs";
import { npcPosIdentity } from "../../../../importables/identity";
import { removedFormatting } from "../../../../utils/helpers";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

let scanInFlight = false;

export function isNpcScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseNpcs(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "NPC");
}

export function houseNpcsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "NPC");
}

export function scanHouseNpcs(): void {
    if (scanInFlight || TaskManager.isBusy()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            // NPCs are identified by position (names can repeat and change), so
            // the scan keys presence by position and carries the name as the
            // browser's display label.
            const entries = await listAllNpcs(ctx);
            const identities: string[] = [];
            const labels = new Map<string, string>();
            for (let i = 0; i < entries.length; i++) {
                const identity = npcPosIdentity(entries[i].pos);
                identities.push(identity);
                labels.set(identity, removedFormatting(entries[i].name));
            }
            recordHouseScan(uuid, "NPC", identities, labels);
            showToast(
                `Scanned ${identities.length} NPC${identities.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`NPC scan failed: ${String(err)}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] NPC scan failed: ${String(err)}`);
    });
}
