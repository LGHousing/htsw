/// <reference types="../../../CTAutocomplete" />

import { getHousingUuid } from "./housing";
import {
    asStringSetValue,
    defineRootDoc,
    serializeStringSet,
} from "../../persistence/store";
import { markGuiDirty } from "../lib/dirty";

// Trust is on by default, so the list holds the exceptions: a house is
// trusted unless the user turned it off. Default `refuse` read policy: a list
// that cannot be parsed must never be replaced with an empty one. Silently
// forgetting which houses the user distrusted would trust them again behind
// the user's back, so an unhealthy document falls back to untrusted.
const untrustedHouses = defineRootDoc<Set<string>>({
    file: "untrusted-houses.json",
    fallback: new Set<string>(),
    parse: asStringSetValue,
    serialize: serializeStringSet,
});

export function isHouseTrusted(uuid: string): boolean {
    if (!untrustedHouses.healthy()) return false;
    return !untrustedHouses.get().has(uuid);
}

export function setHouseTrust(uuid: string, trusted: boolean): boolean {
    if (!untrustedHouses.healthy()) return false;
    const current = untrustedHouses.get();
    if (!current.has(uuid) === trusted) return true;
    const next = new Set<string>(current);
    if (trusted) next.delete(uuid);
    else next.add(uuid);
    if (!untrustedHouses.set(next)) return false;
    markGuiDirty();
    return true;
}

/** Back to the default (trusted). Used when a house is removed entirely, so a
 *  stale exception cannot outlive the house it was about. */
export function clearHouseTrust(uuid: string): boolean {
    return setHouseTrust(uuid, true);
}

/** Trust mode is per-house: an in-flight import trusts the cache iff the
 *  current housing UUID is not in the untrusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    const uuid = getHousingUuid();
    return uuid !== null && isHouseTrusted(uuid);
}
