import type { Importable, ImportableItem } from "htsw/types";

import { ALL_IMPORTABLE_TYPES, HOUSE_READERS } from "../../importables/houseReaders";
import {
    getImportCacheWriteRevision,
    houseTypeScanned,
    listCachedImportables,
    readImportableCache,
} from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { getHousingUuid } from "../state/housing";
import { isHouseTrusted } from "../state/trust";
import { buildCacheStatusRow } from "../../importCache/status";
import type { LinkStatusKey } from "./linkStatus";
import { itemDependencyIndexFor } from "../../importables/items/dependencyIndex";

type HousePresenceState = "unscanned" | "present" | "absent";

type ItemReferenceEvidence = {
    housingUuid: string;
    cacheRevision: number;
    fingerprintsByName: Map<string, string[]>;
};

let itemReferenceEvidence: ItemReferenceEvidence | null = null;

function cachedItemReferenceFingerprints(
    housingUuid: string,
    itemName: string
): readonly string[] {
    const cacheRevision = getImportCacheWriteRevision();
    if (
        itemReferenceEvidence === null ||
        itemReferenceEvidence.housingUuid !== housingUuid ||
        itemReferenceEvidence.cacheRevision !== cacheRevision
    ) {
        const fingerprintsByName = new Map<string, string[]>();
        for (const type of ALL_IMPORTABLE_TYPES) {
            if (type === "ITEM") continue;
            for (const listed of listCachedImportables(housingUuid, type)) {
                const cached = readImportableCache(housingUuid, type, listed.name);
                const dependencies = cached?.itemDependencies?.dependencies;
                if (dependencies === undefined) continue;
                for (const dependency of dependencies) {
                    if (dependency.target.kind !== "named") continue;
                    const existing = fingerprintsByName.get(dependency.target.name);
                    if (existing === undefined) {
                        fingerprintsByName.set(dependency.target.name, [
                            dependency.fingerprint,
                        ]);
                    } else if (existing.indexOf(dependency.fingerprint) < 0) {
                        existing.push(dependency.fingerprint);
                    }
                }
            }
        }
        itemReferenceEvidence = {
            housingUuid,
            cacheRevision,
            fingerprintsByName,
        };
    }
    return itemReferenceEvidence.fingerprintsByName.get(itemName) ?? [];
}

function referencedItemStatus(
    housingUuid: string,
    item: ImportableItem
): { key: LinkStatusKey; tooltip: string } | null {
    const fingerprints = cachedItemReferenceFingerprints(housingUuid, item.name);
    if (fingerprints.length === 0) return null;
    const current = itemDependencyIndexFor(item)?.fingerprintOfItem(item);
    if (current === undefined) {
        return { key: "unknown", tooltip: "Could not compare this referenced item" };
    }
    for (const fingerprint of fingerprints) {
        if (fingerprint !== current) {
            return {
                key: "differs",
                tooltip: "Referenced item differs from cached house content",
            };
        }
    }
    return { key: "matches", tooltip: "Referenced item matches cached house content" };
}

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

export function importableLinkStatus(imp: Importable): {
    key: LinkStatusKey;
    tooltip: string;
} {
    const uuid = getHousingUuid();
    if (uuid === null) return { key: "unknown", tooltip: "No house detected" };
    // Items have no house-side listing to scan; their content-type entry is
    // export-only and has no rows. An item exists only where an action or menu
    // references it. Presence can't be answered for these, so fall back to the
    // import baseline: does your file still match what was last imported?
    if (HOUSE_READERS[imp.type] === null) {
        const baseline = cacheStateForImportable(imp);
        if (baseline === "current") {
            return { key: "matches", tooltip: "Files match this house" };
        }
        if (baseline === "modified") {
            return {
                key: "differs",
                tooltip: "Import will update the house from these files",
            };
        }
        if (imp.type === "ITEM") {
            const referenced = referencedItemStatus(uuid, imp);
            if (referenced !== null) return referenced;
        }
        // Never imported: file-side only as far as we can tell (items can't be
        // listed from a house to confirm otherwise). Show it as not-yet-linked
        // rather than "unknown" — import is the action that places/links it.
        return {
            key: "oneSided",
            tooltip:
                imp.type === "ITEM"
                    ? "Not found in cached house content"
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
        return {
            key: "differs",
            tooltip: "Import will update the house from these files",
        };
    }
    return presence === "present"
        ? { key: "present", tooltip: "In this house; content not read yet" }
        : { key: "unknown", tooltip: "No Knowledge read yet" };
}
