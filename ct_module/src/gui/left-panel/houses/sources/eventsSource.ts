/// <reference types="../../../../../CTAutocomplete" />

import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { knownEventNames } from "../../../../importables/events/listEvents";
import {
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "../../../../importCache/cache";

function eventRows(uuid: string | null): HouseImportable[] {
    if (uuid === null) return [];
    const cached = listCachedImportables(uuid, "EVENT");
    const byName = new Map<string, HouseImportable>();
    for (let i = 0; i < cached.length; i++) byName.set(cached[i].name, cached[i]);

    const names = knownEventNames();
    const out: HouseImportable[] = [];
    for (let i = 0; i < names.length; i++) {
        const cachedRow = byName.get(names[i]);
        out.push(
            cachedRow ?? {
                name: names[i],
                type: "EVENT",
                verified: false,
                importable: null,
            }
        );
    }
    return out;
}

export function isEventScanInFlight(): boolean {
    return false;
}

export function getHouseEvents(uuid: string | null): HouseImportable[] {
    return eventRows(uuid);
}

export function houseEventsScanned(uuid: string | null): boolean {
    return uuid !== null;
}

export function scanHouseEvents(): void {
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const names = knownEventNames();
    try {
        recordHouseScan(uuid, "EVENT", names);
    } catch (error) {
        showToast(`Event refresh failed: ${String(error)}`, 0xffe85c5c, 8000);
        return;
    }
    showToast(
        `Refreshed ${names.length} event${names.length === 1 ? "" : "s"}`,
        0xff5cb85c
    );
}
