/// <reference types="../../../../../CTAutocomplete" />

import type { FunctionIcon } from "htsw/types";

import { TaskManager } from "../../../../tasks/manager";
import { getHousingUuid } from "../../../state";
import { showToast } from "../../../toast";
import { markGuiDirty } from "../../../lib/dirty";
import { listAllFunctionEntries } from "../../../../importables/functions/listFunctions";
import { functionIconFromSnapshot } from "../../../../importables/functions/icon";
import {
    deleteImportableCache,
    houseTypeScanned,
    listCachedImportables,
    recordHouseScan,
    writePresence,
    type HouseImportable,
} from "../../../../importCache/cache";

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

// Liveness: Hypixel announces create/delete/rename in chat. Only the house we're
// standing in can change, so every mutation targets the current UUID.
// Read the event through a declared parameter only: on this Rhino build,
// pulling a ClientChatReceivedEvent out of `arguments` (which is what a
// `...args` rest parameter compiles to) throws
// "InternalError: Invalid JavaScript value" and silently kills the handler.
register("chat", (event) => {
    // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    let m = msg.match(/^Created function (.+)!$/);
    if (m !== null) {
        writePresence(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Deleted the function (.+)$/);
    if (m !== null) {
        deleteImportableCache(uuid, "FUNCTION", m[1]);
        return;
    }
    m = msg.match(/^Renamed function (.+) to (.+)$/);
    if (m !== null) {
        // A name containing " to " makes the split ambiguous; leave it for a
        // rescan rather than trust the heuristic.
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) return;
        deleteImportableCache(uuid, "FUNCTION", m[1]);
        writePresence(uuid, "FUNCTION", m[2]);
    }
});
