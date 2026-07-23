import type { Importable } from "htsw/types";

import { HOUSE_READERS } from "../../importables/export/readers";
import {
    peekHouseTypeScanned,
    peekImportableCache,
} from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { getHousingUuid } from "../state/housing";
import { isHouseTrusted } from "../state/trust";
import { buildCacheStatusRowFromEntry } from "../../importCache/status";
import type { LinkStatusKey } from "./linkStatus";
import { requestImportableCacheWarm } from "./cacheWarm";

type HousePresenceState = "unscanned" | "present" | "absent";

export function cachedImportableLinkStatus(imp: Importable): {
    key: LinkStatusKey;
    tooltip: string;
} | null {
    const uuid = getHousingUuid();
    if (uuid === null) return { key: "unknown", tooltip: "No house detected" };
    const cached = peekImportableCache(uuid, imp.type, importableIdentity(imp));
    if (!cached.loaded) {
        requestImportableCacheWarm(uuid, imp);
        return null;
    }
    const baseline = buildCacheStatusRowFromEntry(imp, cached.entry).state;
    if (HOUSE_READERS[imp.type] === null) {
        if (baseline === "current") {
            return { key: "matches", tooltip: "Files match this house" };
        }
        if (baseline === "modified") {
            return {
                key: "differs",
                tooltip: "Import will update the house from these files",
            };
        }
        return {
            key: "oneSided",
            tooltip:
                imp.type === "ITEM"
                    ? "Not found in cached house content"
                    : "Not listed from a house — import to place it",
        };
    }
    let presence: HousePresenceState;
    if (imp.type === "EVENT") {
        presence = "present";
    } else {
        const scanned = peekHouseTypeScanned(uuid, imp.type);
        if (scanned === null) {
            requestImportableCacheWarm(uuid, imp);
            return null;
        }
        presence =
            cached.house !== null ? "present" : scanned ? "absent" : "unscanned";
    }
    if (presence === "absent") {
        return { key: "oneSided", tooltip: "Not in this house" };
    }
    if (!isHouseTrusted(uuid)) {
        return presence === "present"
            ? { key: "present", tooltip: "Exists in this house" }
            : { key: "unknown", tooltip: "Scan this house to check whether it exists" };
    }
    if (baseline === "current") {
        return { key: "matches", tooltip: "Files match this house" };
    }
    if (baseline === "modified") {
        return {
            key: "differs",
            tooltip: "Import will update the house from these files",
        };
    }
    return presence === "present"
        ? { key: "present", tooltip: "In this house; content not read yet" }
        : { key: "unknown", tooltip: "No Knowledge read yet" };
}
