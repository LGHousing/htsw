/// <reference types="../../../CTAutocomplete" />

import { getHousingUuid } from "./housing";

const TRUSTED_HOUSES_FILE = "./htsw/.cache/trusted-houses.json";
let trustedHousesLoaded = false;
const trustedHouses: Set<string> = new Set();

function loadTrustedHouses(): void {
    if (trustedHousesLoaded) return;
    try {
        if (FileLib.exists(TRUSTED_HOUSES_FILE)) {
            const raw = String(FileLib.read(TRUSTED_HOUSES_FILE) ?? "");
            if (raw.trim() !== "") {
                const arr = JSON.parse(raw) as unknown;
                if (Array.isArray(arr)) {
                    for (let i = 0; i < arr.length; i++) {
                        if (typeof arr[i] === "string") trustedHouses.add(arr[i] as string);
                    }
                }
            }
        }
        // Only mark loaded once a read actually succeeded (a missing file counts
        // — that's a legitimately empty set). On a transient read/parse failure
        // we leave this false so a later call retries, rather than letting
        // setHouseTrust persist a partial set over the on-disk one.
        trustedHousesLoaded = true;
    } catch (_e) {}
}
function saveTrustedHouses(): void {
    try {
        const arr: string[] = [];
        trustedHouses.forEach((uuid) => arr.push(uuid));
        FileLib.write(TRUSTED_HOUSES_FILE, JSON.stringify(arr), true);
    } catch (_e) {}
}

export function isHouseTrusted(uuid: string): boolean {
    loadTrustedHouses();
    return trustedHouses.has(uuid);
}
export function setHouseTrust(uuid: string, trusted: boolean): void {
    loadTrustedHouses();
    if (trusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
    saveTrustedHouses();
}
/** Trust mode is per-house: an in-flight import trusts the cache iff the
 *  current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    loadTrustedHouses();
    const uuid = getHousingUuid();
    return uuid !== null && trustedHouses.has(uuid);
}
