import type { Importable } from "htsw/types";

import { ensureParentDirs } from "../utils/filesystem";
import { javaType } from "../utils/java";
import { runOnMainThread } from "../utils/mainThread";
import { importableIdentity, importableKey } from "../importables/identity";
import { actionListsOfImportable } from "./actionLists";
import {
    ACTION_LIST_CONTENT_HASH_VERSION,
    ACTION_LIST_SCAN_HASH_VERSION,
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../housingSync/actions/scanHash";
import type {
    ItemDependencySnapshot,
    ItemDependencyTarget,
} from "../importables/items/dependencyIndex";
import type { ItemFieldContent } from "../housingSync/items/fieldContent";
import { memoizedImportableHash } from "./hashMemo";

const HOUSE_LOCK_SCHEMA_VERSION = 1;
const HOUSE_LOCK_FILE = "house.lock.json";

function formatHouseLockError(error: unknown): string {
    const stack = (error as { stack?: unknown } | null)?.stack;
    return typeof stack === "string" && stack ? stack : String(error);
}

type HouseLockEntry = {
    type: Importable["type"];
    identity: string;
    hash: string;
    listScanHashes?: Record<string, string>;
    listContentHashes?: Record<string, string>;
    itemDependencies?: ItemDependencySnapshot;
};

export type HouseLock = {
    schemaVersion: typeof HOUSE_LOCK_SCHEMA_VERSION;
    houseUuid: string | null;
    scanHashVersion?: number;
    contentHashVersion?: number;
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
        contentHashVersion?: unknown;
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
    const contentHashVersion =
        typeof obj.contentHashVersion === "number" ? obj.contentHashVersion : undefined;
    const exposeListScanHashes = scanHashVersion === ACTION_LIST_SCAN_HASH_VERSION;
    const exposeListContentHashes =
        contentHashVersion === ACTION_LIST_CONTENT_HASH_VERSION;
    const records = obj.importables as Record<string, unknown>;
    for (const key in records) {
        const entry = records[key];
        if (entry === null || typeof entry !== "object") continue;
        const e = entry as {
            type?: unknown;
            identity?: unknown;
            hash?: unknown;
            listScanHashes?: unknown;
            listContentHashes?: unknown;
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
        if (exposeListContentHashes) {
            const listContentHashes = parseStringRecord(e.listContentHashes);
            if (listContentHashes !== undefined) {
                parsedEntry.listContentHashes = listContentHashes;
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
        ...(contentHashVersion !== undefined ? { contentHashVersion } : {}),
        importables,
    };
}

function parseItemDependencyTarget(value: unknown): ItemDependencyTarget | null {
    if (value === null || typeof value !== "object") return null;
    const target = value as {
        kind?: unknown;
        name?: unknown;
        path?: unknown;
        id?: unknown;
    };
    if (target.kind === "named" && typeof target.name === "string") {
        return { kind: "named", name: target.name };
    }
    if (target.kind === "snbtPath" && typeof target.path === "string") {
        return { kind: "snbtPath", path: target.path };
    }
    if (target.kind === "vanilla" && typeof target.id === "string") {
        return { kind: "vanilla", id: target.id };
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

export function houseLockAcceptsUpdate(
    importJsonPath: string,
    housingUuid: string
): boolean {
    const path = houseLockPathForImportJson(importJsonPath);
    if (!FileLib.exists(path)) return true;
    const lock = readHouseLock(importJsonPath);
    if (lock === null) return false;
    if (lock.houseUuid !== null && lock.houseUuid !== housingUuid) return false;
    return (
        (lock.scanHashVersion === undefined ||
            lock.scanHashVersion === ACTION_LIST_SCAN_HASH_VERSION) &&
        (lock.contentHashVersion === undefined ||
            lock.contentHashVersion === ACTION_LIST_CONTENT_HASH_VERSION)
    );
}

function writeHouseLock(lockPath: string, lock: HouseLock): boolean {
    try {
        ensureParentDirs(lockPath);
        FileLib.write(lockPath, JSON.stringify(lock, null, 4), true);
        return true;
    } catch (error) {
        console.error(`[htsw] house.lock write failed: ${formatHouseLockError(error)}`);
        return false;
    }
}

export type HouseLockImportableUpdate = {
    importable: Importable;
    itemDependencies?: ItemDependencySnapshot;
    itemContent: ItemFieldContent | undefined;
};

type PreparedHouseLockImportableUpdate = {
    type: Importable["type"];
    identity: string;
    hash: string;
    listScanHashes: Record<string, string>;
    listContentHashes: Record<string, string>;
    itemDependencies?: ItemDependencySnapshot;
};

export function upsertHouseLockImportable(
    importJsonPath: string,
    housingUuid: string,
    update: HouseLockImportableUpdate
): boolean {
    return upsertHouseLockImportables(importJsonPath, housingUuid, [update]);
}

export function upsertHouseLockImportables(
    importJsonPath: string,
    housingUuid: string,
    updates: readonly HouseLockImportableUpdate[]
): boolean {
    if (updates.length === 0) return true;
    return upsertPreparedHouseLockImportables(
        importJsonPath,
        housingUuid,
        updates.map(prepareHouseLockImportableUpdate)
    );
}

export function upsertHouseLockImportablesOffThread(
    importJsonPath: string,
    housingUuid: string,
    updates: readonly HouseLockImportableUpdate[]
): Promise<boolean> {
    if (updates.length === 0) return Promise.resolve(true);
    const snapshot = updates.slice();
    return new Promise((resolve) => {
        const Thread = javaType("java.lang.Thread");
        const Runnable = javaType("java.lang.Runnable");
        try {
            const thread = new Thread(
                new Runnable({
                    run: function () {
                        let prepared: PreparedHouseLockImportableUpdate[] | null = null;
                        try {
                            prepared = snapshot.map(prepareHouseLockImportableUpdate);
                        } catch (error) {
                            console.error(
                                `[htsw] house.lock prepare failed: ${formatHouseLockError(error)}`
                            );
                        }
                        runOnMainThread(() => {
                            resolve(
                                prepared !== null &&
                                    upsertPreparedHouseLockImportables(
                                        importJsonPath,
                                        housingUuid,
                                        prepared
                                    )
                            );
                        });
                    },
                })
            );
            thread.setDaemon(true);
            thread.start();
        } catch (_error) {
            resolve(upsertHouseLockImportables(importJsonPath, housingUuid, snapshot));
        }
    });
}

function prepareHouseLockImportableUpdate(
    update: HouseLockImportableUpdate
): PreparedHouseLockImportableUpdate {
    const importable = update.importable;
    const identity = importableIdentity(importable);
    const listScanHashes: Record<string, string> = {};
    const listContentHashes: Record<string, string> = {};
    for (const { basePath, actions } of actionListsOfImportable(importable)) {
        listScanHashes[basePath] = actionListScanHashFromActions(actions);
        listContentHashes[basePath] = actionListContentHashFromActions(
            actions,
            update.itemContent
        );
    }
    return {
        type: importable.type,
        identity,
        hash: memoizedImportableHash(importable),
        listScanHashes,
        listContentHashes,
        ...(update.itemDependencies !== undefined
            ? { itemDependencies: update.itemDependencies }
            : {}),
    };
}

function upsertPreparedHouseLockImportables(
    importJsonPath: string,
    housingUuid: string,
    updates: readonly PreparedHouseLockImportableUpdate[]
): boolean {
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    lock.houseUuid = housingUuid;
    lock.scanHashVersion = ACTION_LIST_SCAN_HASH_VERSION;
    lock.contentHashVersion = ACTION_LIST_CONTENT_HASH_VERSION;
    for (const update of updates) {
        lock.importables[importableKey(update.type, update.identity)] = {
            type: update.type,
            identity: update.identity,
            hash: update.hash,
            listScanHashes: update.listScanHashes,
            listContentHashes: update.listContentHashes,
            ...(update.itemDependencies !== undefined
                ? { itemDependencies: update.itemDependencies }
                : {}),
        };
    }
    return writeHouseLock(path, lock);
}
