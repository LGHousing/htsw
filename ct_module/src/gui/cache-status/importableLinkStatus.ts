import type { Importable } from "htsw/types";

import { HOUSE_READERS } from "../../importables/houseReaders";
import { houseTypeScanned, listCachedImportables } from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { getHousingUuid } from "../state/housing";
import { isHouseTrusted } from "../state/trust";
import { buildCacheStatusRow } from "../../importCache/status";
import type { LinkStatusKey } from "./linkStatus";

type HousePresenceState = "unscanned" | "present" | "absent";

function cacheStateForImportable(importable: Importable) {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    return buildCacheStatusRow(uuid, importable).state;
}

function housePresenceStateFor(imp: Importable): HousePresenceState {
    const uuid = getHousingUuid();
    if (uuid !== null && imp.type === "EVENT") return "present";
    if (uuid === null || !houseTypeScanned(uuid, imp.type)) return "unscanned";
    const identity = importableIdentity(imp);
    const items = listCachedImportables(uuid, imp.type);
    for (let i = 0; i < items.length; i++) {
        if (items[i].name === identity) return "present";
    }
    return "absent";
}

export function importableLinkStatus(
    imp: Importable
): { key: LinkStatusKey; tooltip: string } {
    const uuid = getHousingUuid();
    if (uuid === null) return { key: "unknown", tooltip: "No house detected" };
    // Items have no house-side listing to scan (not in
    // HOUSE_CONTENT_TYPES) — an item exists only where an action or menu
    // references it. Presence can't be answered for these, so fall back to the
    // import baseline: does your file still match what was last imported?
    if (HOUSE_READERS[imp.type] === null) {
        const baseline = cacheStateForImportable(imp);
        if (baseline === "current") {
            return { key: "matches", tooltip: "Files match this house" };
        }
        if (baseline === "modified") {
            return { key: "differs", tooltip: "Import will update the house from these files" };
        }
        // Never imported: file-side only as far as we can tell (items can't be
        // listed from a house to confirm otherwise). Show it as not-yet-linked
        // rather than "unknown" — import is the action that places/links it.
        return {
            key: "oneSided",
            tooltip: imp.type === "ITEM"
                ? "Items can't be listed from a house — import to place it"
                : "Not listed from a house — import to place it",
        };
    }
    const presence = housePresenceStateFor(imp);
    // Once the type is scanned, absence is authoritative: it must win over a
    // stale Knowledge entry, or something the house dropped still shows a match.
    if (presence === "absent") return { key: "oneSided", tooltip: "Not in this house" };
    if (!isHouseTrusted(uuid)) {
        return presence === "present"
            ? { key: "present", tooltip: "Exists in this house" }
            : { key: "unknown", tooltip: "Scan this house to check whether it exists" };
    }
    const cacheState = cacheStateForImportable(imp);
    if (cacheState === "current") {
        return { key: "matches", tooltip: "Files match this house" };
    }
    if (cacheState === "modified") {
        return { key: "differs", tooltip: "Import will update the house from these files" };
    }
    return presence === "present"
        ? { key: "present", tooltip: "In this house; content not read yet" }
        : { key: "unknown", tooltip: "No Knowledge read yet" };
}
