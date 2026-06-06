/// <reference types="../../CTAutocomplete" />

import { TaskManager } from "../tasks/manager";
import { getHousingUuid } from "../gui/state";
import { showToast } from "../gui/toast";
import { listAllFunctionEntries } from "../importables/functions/listFunctions";
import {
    getItems,
    isScanned,
    liveAdd,
    liveRemove,
    liveRename,
    markUnscanned,
    recordScan,
    type HouseItem,
} from "./store";

let scanInFlight = false;

export function isFunctionScanInFlight(): boolean {
    return scanInFlight;
}

export function getHouseFunctions(uuid: string | null): HouseItem[] {
    return getItems(uuid, "FUNCTION");
}

export function houseFunctionsScanned(uuid: string | null): boolean {
    return isScanned(uuid, "FUNCTION");
}

export function scanHouseFunctions(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllFunctionEntries(ctx);
            recordScan(uuid, "FUNCTION", entries);
            showToast(
                `Scanned ${entries.length} function${entries.length === 1 ? "" : "s"}`,
                0xff5cb85c
            );
        } finally {
            scanInFlight = false;
        }
    }).catch((err: unknown) => {
        showToast(`Function scan failed: ${err}`, 0xffe85c5c, 8000);
        ChatLib.chat(`&c[htsw] Function scan failed: ${err}`);
    });
}

register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    let m = msg.match(/^Created function (.+)!$/);
    if (m !== null) {
        liveAdd(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Deleted the function (.+)$/);
    if (m !== null) {
        liveRemove(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Renamed function (.+) to (.+)$/);
    if (m !== null) {
        // Names containing " to " make this ambiguous; on any doubt force a
        // re-scan instead of trusting the heuristic split.
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) {
            markUnscanned(uuid, "FUNCTION");
        } else {
            liveRename(uuid, "FUNCTION", m[1], m[2]);
        }
    }
});
