/// <reference types="../../../../CTAutocomplete" />

import { TaskManager } from "../../../tasks/manager";
import { getHousingUuid } from "../../state";
import { showToast } from "../../toast";
import {
    listAllFunctionEntries,
    type FunctionListEntry,
} from "../../../importables/functions/listFunctions";

export type HouseItem = { name: string; icon?: FunctionListEntry["icon"] };

const STORE_PATH = "./config/ChatTriggers/modules/HTSW/house-functions.json";

const functionsByHouse = new Map<string, HouseItem[]>();
const scannedHouses = new Set<string>();
let scanInFlight = false;
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(STORE_PATH)) return;
        const raw = String(FileLib.read(STORE_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return;
        for (const uuid in parsed) {
            if (!Object.prototype.hasOwnProperty.call(parsed, uuid)) continue;
            const arr = (parsed as Record<string, unknown>)[uuid];
            if (!Array.isArray(arr)) continue;
            const items: HouseItem[] = [];
            for (let i = 0; i < arr.length; i++) {
                const it = arr[i];
                if (it !== null && typeof it === "object" && typeof it.name === "string") {
                    items.push({ name: it.name, icon: it.icon ?? null });
                }
            }
            functionsByHouse.set(uuid, items);
            scannedHouses.add(uuid);
        }
    } catch (_e) {
        // ignore a corrupt cache; a Rescan rebuilds it
    }
}

function persist(): void {
    try {
        const obj: Record<string, HouseItem[]> = {};
        for (const uuid of scannedHouses) {
            const items = functionsByHouse.get(uuid);
            if (items !== undefined) obj[uuid] = items;
        }
        FileLib.write(STORE_PATH, JSON.stringify(obj, null, 2), true);
    } catch (_e) {
        // ignore
    }
}

export function getHouseFunctions(uuid: string | null): HouseItem[] {
    load();
    if (uuid === null) return [];
    return functionsByHouse.get(uuid) ?? [];
}

export function houseFunctionsScanned(uuid: string | null): boolean {
    load();
    return uuid !== null && scannedHouses.has(uuid);
}

export function isScanInFlight(): boolean {
    return scanInFlight;
}

function setFunctions(uuid: string, items: HouseItem[]): void {
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    functionsByHouse.set(uuid, sorted);
}

export function scanHouseFunctions(): void {
    if (scanInFlight || TaskManager.hasRunningTasks()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    scanInFlight = true;
    TaskManager.run(async (ctx) => {
        try {
            const entries = await listAllFunctionEntries(ctx);
            setFunctions(uuid, entries);
            scannedHouses.add(uuid);
            persist();
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

// Liveness: Hypixel announces create/delete/rename in chat. These come from the
// server (not our own ChatLib.chat output), so the chat trigger fires for both
// manual edits and edits we make during an import. Only the house we're standing
// in can change, so every mutation targets the current UUID.
function liveAdd(uuid: string, name: string): void {
    const list = functionsByHouse.get(uuid) ?? [];
    if (list.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    setFunctions(uuid, list.concat([{ name, icon: null }]));
    persist();
}
function liveRemove(uuid: string, name: string): void {
    const list = functionsByHouse.get(uuid);
    if (list === undefined) return;
    setFunctions(uuid, list.filter((i) => i.name.toLowerCase() !== name.toLowerCase()));
    persist();
}
function liveRename(uuid: string, oldName: string, newName: string): void {
    const list = functionsByHouse.get(uuid);
    if (list === undefined) return;
    setFunctions(
        uuid,
        list.map((i) =>
            i.name.toLowerCase() === oldName.toLowerCase() ? { name: newName, icon: i.icon } : i
        )
    );
    persist();
}

register("chat", (event: any) => {
    const msg = ChatLib.getChatMessage(event, false);
    if (typeof msg !== "string") return;
    const uuid = getHousingUuid();
    if (uuid === null) return;

    let m = msg.match(/^Created function (.+)!$/);
    if (m !== null) {
        liveAdd(uuid, m[1]);
        return;
    }
    m = msg.match(/^Deleted the function (.+)$/);
    if (m !== null) {
        liveRemove(uuid, m[1]);
        return;
    }
    m = msg.match(/^Renamed function (.+) to (.+)$/);
    if (m !== null) {
        // Names containing " to " make this ambiguous; on any doubt force a
        // re-scan instead of trusting the heuristic split.
        if (m[1].indexOf(" to ") !== -1 || m[2].indexOf(" to ") !== -1) {
            scannedHouses.delete(uuid);
            persist();
        } else {
            liveRename(uuid, m[1], m[2]);
        }
    }
});

load();
