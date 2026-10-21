/// <reference types="../../../../../CTAutocomplete" />

import type { FunctionIcon } from "htsw/types";

import { TaskManager } from "@htsw/importer/tasks/manager";
import { getHousingUuid } from "@htsw/importer/runtime/state/index";
import { showToast } from "../../../toast";
import { markGuiDirty } from "../../../lib/dirty";
import { listAllFunctionEntries } from "@htsw/importer/importables/functions/listFunctions";
import { functionIconFromSnapshot } from "../../../../importables/functions/icon";
import {
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    type HouseImportable,
} from "@htsw/importer/importCache/cache";

let scanInFlight = false;

export function isFunctionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseFunctions(uuid: string | null): HouseImportable[] {
    return listCachedImportables(uuid, "FUNCTION");
}

export function houseFunctionsScanned(uuid: string | null): boolean {
    return houseTypeScanned(uuid, "FUNCTION");
}

export function scanHouseFunctions(): void {
    if (scanInFlight || TaskManager.isBusy()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllFunctionEntries(ctx);
            const icons = new Map<string, FunctionIcon>();
            for (let i = 0; i < entries.length; i++) {
                const icon = functionIconFromSnapshot(entries[i].icon);
                if (icon !== undefined) icons.set(entries[i].name, icon);
            }
            recordHouseScan(
                uuid,
                "FUNCTION",
                entries.map((e) => e.name),
                undefined,
                icons
            );
            markGuiDirty();
            showToast(
                `Scanned ${entries.length} function${entries.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Function scan failed: ${String(err)}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Function scan failed: ${String(err)}`);
    });
}
