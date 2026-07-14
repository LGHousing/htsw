/// <reference types="../../../CTAutocomplete" />

import { getHousingUuid } from "./housing";
import {
    readJsonSettingsFile,
    writeJsonSettingsFile,
} from "../../persistence/settingsFiles";

const TRUSTED_HOUSES_FILE_NAME = "trusted-houses.json";
let trustedHousesLoaded = false;
const trustedHouses: Set<string> = new Set();

function loadTrustedHouses(): boolean {
    if (trustedHousesLoaded) return true;
    const stored = readJsonSettingsFile(TRUSTED_HOUSES_FILE_NAME);
    if (!stored.ok) return false;
    if (stored.found && !Array.isArray(stored.value)) return false;

    const values: unknown[] = stored.found ? stored.value as unknown[] : [];
    for (let i = 0; i < values.length; i++) {
        if (typeof values[i] !== "string") return false;
    }
    trustedHouses.clear();
    for (let i = 0; i < values.length; i++) {
        trustedHouses.add(values[i] as string);
    }
    trustedHousesLoaded = true;
    return true;
}

function saveTrustedHouses(): boolean {
    const values: string[] = [];
    trustedHouses.forEach((uuid) => values.push(uuid));
    values.sort();
    return writeJsonSettingsFile(TRUSTED_HOUSES_FILE_NAME, values);
}

export function isHouseTrusted(uuid: string): boolean {
    loadTrustedHouses();
    return trustedHouses.has(uuid);
}
export function setHouseTrust(uuid: string, trusted: boolean): boolean {
    if (!loadTrustedHouses()) return false;
    const wasTrusted = trustedHouses.has(uuid);
    if (wasTrusted === trusted) return true;
    if (trusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
    if (saveTrustedHouses()) return true;
    if (wasTrusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
    return false;
}
/** Trust mode is per-house: an in-flight import trusts the cache iff the
 *  current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    loadTrustedHouses();
    const uuid = getHousingUuid();
    return uuid !== null && trustedHouses.has(uuid);
}
