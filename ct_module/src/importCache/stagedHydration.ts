import type { Action, Importable } from "htsw/types";

import {
    ACTION_LIST_CONTENT_HASH_VERSION,
    ACTION_LIST_SCAN_HASH_VERSION,
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../housingSync/actions/scanHash";
import { atomicWriteText, encodeFilesystemComponent } from "../utils/filesystem";
import { cacheDirFor, IMPORT_CACHE_ROOT } from "./paths";

const STAGED_HYDRATION_SCHEMA_VERSION = 1;

export type StagedActionListHydration = {
    scanHash: string;
    contentHash: string;
    actions: readonly Action[];
};

type StoredStagedActionListHydration = StagedActionListHydration & {
    schemaVersion: typeof STAGED_HYDRATION_SCHEMA_VERSION;
    scanHashVersion: typeof ACTION_LIST_SCAN_HASH_VERSION;
    contentHashVersion: typeof ACTION_LIST_CONTENT_HASH_VERSION;
    writtenAt: string;
};

function stagedHydrationPath(
    housingUuid: string,
    type: Importable["type"],
    identity: string,
    basePath: string
): string {
    const name = encodeFilesystemComponent(identity, { escapeDots: true });
    const list = encodeFilesystemComponent(basePath, { escapeDots: true });
    return `${IMPORT_CACHE_ROOT}/${housingUuid}/${cacheDirFor(type)}/${name}.${list}.hydration.json`;
}

export function writeStagedActionListHydration(
    housingUuid: string,
    type: Importable["type"],
    identity: string,
    basePath: string,
    actions: readonly Action[]
): boolean {
    const stored: StoredStagedActionListHydration = {
        schemaVersion: STAGED_HYDRATION_SCHEMA_VERSION,
        scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION,
        contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION,
        writtenAt: new Date().toISOString(),
        scanHash: actionListScanHashFromActions(actions),
        contentHash: actionListContentHashFromActions(actions),
        actions,
    };
    return atomicWriteText(
        stagedHydrationPath(housingUuid, type, identity, basePath),
        JSON.stringify(stored, null, 4)
    );
}

export function readStagedActionListHydration(
    housingUuid: string,
    type: Importable["type"],
    identity: string,
    basePath: string
): StagedActionListHydration | null {
    const path = stagedHydrationPath(housingUuid, type, identity, basePath);
    if (!FileLib.exists(path)) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(FileLib.read(path));
    } catch (_error) {
        return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const stored = parsed as Partial<StoredStagedActionListHydration>;
    if (
        stored.schemaVersion !== STAGED_HYDRATION_SCHEMA_VERSION ||
        stored.scanHashVersion !== ACTION_LIST_SCAN_HASH_VERSION ||
        stored.contentHashVersion !== ACTION_LIST_CONTENT_HASH_VERSION ||
        typeof stored.scanHash !== "string" ||
        typeof stored.contentHash !== "string" ||
        !Array.isArray(stored.actions)
    ) {
        return null;
    }
    if (
        actionListScanHashFromActions(stored.actions) !== stored.scanHash ||
        actionListContentHashFromActions(stored.actions) !== stored.contentHash
    ) {
        return null;
    }
    return {
        scanHash: stored.scanHash,
        contentHash: stored.contentHash,
        actions: stored.actions,
    };
}
