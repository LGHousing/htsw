/// <reference types="../../../CTAutocomplete" />

import { getHousingUuid } from "./housing";
import {
    asStringSetValue,
    defineRootDoc,
    serializeStringSet,
} from "../../persistence/store";
import { markGuiDirty } from "../lib/dirty";

// Default `refuse` read policy: a trust list that cannot be parsed must never
// be replaced with an empty one. Silently forgetting which houses are trusted
// turns the next import into a full re-read, and the user has no way to know
// why or to reconstruct the list.
const trustedHouses = defineRootDoc<Set<string>>({
    file: "trusted-houses.json",
    fallback: new Set<string>(),
    parse: asStringSetValue,
    serialize: serializeStringSet,
});

export function isHouseTrusted(uuid: string): boolean {
    return trustedHouses.get().has(uuid);
}

export function setHouseTrust(uuid: string, trusted: boolean): boolean {
    if (!trustedHouses.healthy()) return false;
    const current = trustedHouses.get();
    if (current.has(uuid) === trusted) return true;
    const next = new Set<string>(current);
    if (trusted) next.add(uuid);
    else next.delete(uuid);
    if (!trustedHouses.set(next)) return false;
    markGuiDirty();
    return true;
}

/** Trust mode is per-house: an in-flight import trusts the cache iff the
 *  current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    const uuid = getHousingUuid();
    return uuid !== null && trustedHouses.get().has(uuid);
}
