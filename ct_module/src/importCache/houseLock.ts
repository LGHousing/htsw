import type { Importable } from "htsw/types";

import { ensureParentDirs } from "../utils/filesystem";
import { importableIdentity, importableKey } from "../importables/identity";
import { importableHash } from "./hash";
import { actionListsOfImportable } from "./actionLists";
import {
    ACTION_LIST_SCAN_HASH_VERSION,
    actionListScanHashFromActions,
} from "../housingSync/actions/scanHash";
import type {
    ItemDependencySnapshot,
    ItemDependencyTarget,
} from "../importables/items/dependencyIndex";

const HOUSE_LOCK_SCHEMA_VERSION = 1;
const HOUSE_LOCK_FILE = "house.lock.json";

type HouseLockEntry = {
    type: Importable["type"];
    identity: string;
    hash: string;
    listScanHashes?: Record<string, string>;
    itemDependencies?: ItemDependencySnapshot;
};

export type HouseLock = {
    schemaVersion: typeof HOUSE_LOCK_SCHEMA_VERSION;
    houseUuid: string | null;
    scanHashVersion?: number;
    importables: Record<string, HouseLockEntry>;
};

function parentDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash < 0) return ".";
    if (slash === 0) return "/";
    return norm.substring(0, slash);
}

function houseLockPathForImportJson(importJsonPath: string): string {
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
        parsed = JSON.parse(raw);
    } catch (_e) {
        return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as {
        schemaVersion?: unknown;
        houseUuid?: unknown;
        scanHashVersion?: unknown;
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
    const scanHashVersion =
        typeof obj.scanHashVersion === "number" ? obj.scanHashVersion : undefined;
    const exposeListScanHashes = scanHashVersion === ACTION_LIST_SCAN_HASH_VERSION;
    const records = obj.importables as Record<string, unknown>;
    for (const key in records) {
        const entry = records[key];
        if (entry === null || typeof entry !== "object") continue;
        const e = entry as {
            type?: unknown;
            identity?: unknown;
            hash?: unknown;
            listScanHashes?: unknown;
            itemDependencies?: unknown;
        };
        if (
            typeof e.type !== "string" ||
            typeof e.identity !== "string" ||
            typeof e.hash !== "string"
        ) {
            continue;
        }
        const parsedEntry: HouseLockEntry = {
            type: e.type as Importable["type"],
            identity: e.identity,
            hash: e.hash,
        };
        if (exposeListScanHashes) {
            const listScanHashes = parseStringRecord(e.listScanHashes);
            if (listScanHashes !== undefined) {
                parsedEntry.listScanHashes = listScanHashes;
            }
        }
        const itemDependencies = parseItemDependencySnapshot(e.itemDependencies);
        if (itemDependencies !== undefined) {
            parsedEntry.itemDependencies = itemDependencies;
        }
        importables[key] = parsedEntry;
    }

    return {
        schemaVersion: HOUSE_LOCK_SCHEMA_VERSION,
        houseUuid: obj.houseUuid,
        ...(scanHashVersion !== undefined ? { scanHashVersion } : {}),
        importables,
    };
}

function parseItemDependencyTarget(value: unknown): ItemDependencyTarget | null {
    if (value === null || typeof value !== "object") return null;
    const target = value as {
        kind?: unknown;
        name?: unknown;
        path?: unknown;
    };
    if (target.kind === "named" && typeof target.name === "string") {
        return { kind: "named", name: target.name };
    }
    if (target.kind === "snbtPath" && typeof target.path === "string") {
        return { kind: "snbtPath", path: target.path };
    }
    return null;
}

function parseItemDependencySnapshot(value: unknown): ItemDependencySnapshot | undefined {
    if (value === null || typeof value !== "object") return undefined;
    const snapshot = value as { version?: unknown; dependencies?: unknown };
    if (snapshot.version !== 1 || !Array.isArray(snapshot.dependencies)) {
        return undefined;
    }
    const dependencies: ItemDependencySnapshot["dependencies"] = [];
    for (const value of snapshot.dependencies) {
        if (value === null || typeof value !== "object") return undefined;
        const dependency = value as { target?: unknown; fingerprint?: unknown };
        const target = parseItemDependencyTarget(dependency.target);
        if (target === null || typeof dependency.fingerprint !== "string") {
            return undefined;
        }
        dependencies.push({ target, fingerprint: dependency.fingerprint });
    }
    return { version: 1, dependencies };
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const parsed: Record<string, string> = {};
    for (const key in value as Record<string, unknown>) {
        const entry = (value as Record<string, unknown>)[key];
        if (typeof entry !== "string") return undefined;
        parsed[key] = entry;
    }
    return parsed;
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

function writeHouseLock(lockPath: string, lock: HouseLock): boolean {
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
    importable: Importable,
    itemDependencies?: ItemDependencySnapshot
): boolean {
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    const identity = importableIdentity(importable);
    lock.houseUuid = housingUuid;
    lock.scanHashVersion = ACTION_LIST_SCAN_HASH_VERSION;
    const listScanHashes: Record<string, string> = {};
    for (const { basePath, actions } of actionListsOfImportable(importable)) {
        listScanHashes[basePath] = actionListScanHashFromActions(actions);
    }
    lock.importables[importableKey(importable.type, identity)] = {
        type: importable.type,
        identity,
        hash: importableHash(importable),
        listScanHashes,
        ...(itemDependencies !== undefined ? { itemDependencies } : {}),
    };
    return writeHouseLock(path, lock);
}
