import type { Importable } from "htsw/types";

import { ensureParentDirs } from "../utils/filesystem";
import { importableIdentity, importableKey } from "../importables/identity";
import { importableHash } from "./hash";

const HOUSE_LOCK_SCHEMA_VERSION = 1;
const HOUSE_LOCK_FILE = "house.lock.json";

export type HouseLockEntry = {
    type: Importable["type"];
    identity: string;
    hash: string;
};

export type HouseLock = {
    schemaVersion: typeof HOUSE_LOCK_SCHEMA_VERSION;
    houseUuid: string | null;
    importables: Record<string, HouseLockEntry>;
};

function parentDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    return norm.substring(0, slash);
}

export function houseLockPathForImportJson(importJsonPath: string): string {
    return `${parentDir(importJsonPath)}/${HOUSE_LOCK_FILE}`;
}

function emptyHouseLock(houseUuid: string | null): HouseLock {
    return {
        schemaVersion: HOUSE_LOCK_SCHEMA_VERSION,
        houseUuid,
        importables: {},
    };
}

function parseHouseLock(raw: string | null): HouseLock | null {
    if (raw === null) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw));
    } catch (_e) {
        return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as {
        schemaVersion?: unknown;
        houseUuid?: unknown;
        importables?: unknown;
    };
    if (obj.schemaVersion !== HOUSE_LOCK_SCHEMA_VERSION) return null;
    if (obj.houseUuid !== null && typeof obj.houseUuid !== "string") return null;
    if (
        obj.importables === null ||
        typeof obj.importables !== "object" ||
        Array.isArray(obj.importables)
    ) {
        return null;
    }

    const importables: Record<string, HouseLockEntry> = {};
    const records = obj.importables as Record<string, unknown>;
    for (const key in records) {
        const entry = records[key];
        if (entry === null || typeof entry !== "object") continue;
        const e = entry as {
            type?: unknown;
            identity?: unknown;
            hash?: unknown;
        };
        if (
            typeof e.type !== "string" ||
            typeof e.identity !== "string" ||
            typeof e.hash !== "string"
        ) {
            continue;
        }
        importables[key] = {
            type: e.type as Importable["type"],
            identity: e.identity,
            hash: e.hash,
        };
    }

    return {
        schemaVersion: HOUSE_LOCK_SCHEMA_VERSION,
        houseUuid: obj.houseUuid,
        importables,
    };
}

export function readHouseLock(importJsonPath: string): HouseLock | null {
    const path = houseLockPathForImportJson(importJsonPath);
    if (!FileLib.exists(path)) return null;
    let raw: string | null;
    try {
        raw = FileLib.read(path);
    } catch (_e) {
        raw = null;
    }
    return parseHouseLock(raw);
}

export function houseLockEntryFor(
    lock: HouseLock | null,
    type: Importable["type"],
    identity: string
): HouseLockEntry | null {
    if (lock === null) return null;
    return lock.importables[importableKey(type, identity)] ?? null;
}

export function writeHouseLock(lockPath: string, lock: HouseLock): boolean {
    try {
        ensureParentDirs(lockPath);
        FileLib.write(lockPath, JSON.stringify(lock, null, 4), true);
        return true;
    } catch (_e) {
        return false;
    }
}

export function upsertHouseLockImportable(
    importJsonPath: string,
    housingUuid: string,
    importable: Importable
): boolean {
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    const identity = importableIdentity(importable);
    lock.houseUuid = housingUuid;
    lock.importables[importableKey(importable.type, identity)] = {
        type: importable.type,
        identity,
        hash: importableHash(importable),
    };
    return writeHouseLock(path, lock);
}

export function upsertHouseLockImportables(
    importJsonPath: string,
    housingUuid: string,
    importables: readonly Importable[]
): boolean {
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    lock.houseUuid = housingUuid;
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        const identity = importableIdentity(importable);
        lock.importables[importableKey(importable.type, identity)] = {
            type: importable.type,
            identity,
            hash: importableHash(importable),
        };
    }
    return writeHouseLock(path, lock);
}
