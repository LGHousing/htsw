import type { Importable } from "htsw/types";

import { ensureParentDirs } from "../utils/filesystem";
import { importableIdentity, importableKey } from "../importables/identity";
import { importableHash } from "./hash";
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
import { itemDependencyIndexFor } from "../importables/items/dependencyIndex";
import type { ItemFieldContent } from "../housingSync/items/fieldContent";

const HOUSE_LOCK_SCHEMA_VERSION = 1;
const CONTENT_HASH_JOURNAL_VERSION = 1;
const HOUSE_LOCK_FILE = "house.lock.json";

export type ContentHashJournalEntry = {
    hash: string;
    recordedAt: string;
};

export function recordedRevertDate(
    journal: readonly ContentHashJournalEntry[] | undefined,
    sourceHash: string,
    liveHash: string
): string | undefined {
    if (journal === undefined) return undefined;
    let sourceIndex = -1;
    let liveIndex = -1;
    for (let i = 0; i < journal.length; i++) {
        if (journal[i].hash === sourceHash) sourceIndex = i;
        if (journal[i].hash === liveHash) liveIndex = i;
    }
    return sourceIndex >= 0 && liveIndex > sourceIndex
        ? journal[sourceIndex].recordedAt
        : undefined;
}

export type HouseLockEntry = {
    type: Importable["type"];
    identity: string;
    hash: string;
    listScanHashes?: Record<string, string>;
    listContentHashes?: Record<string, string>;
    listContentHashJournal?: Record<string, ContentHashJournalEntry[]>;
    itemDependencies?: ItemDependencySnapshot;
};

export type HouseLock = {
    schemaVersion: typeof HOUSE_LOCK_SCHEMA_VERSION;
    houseUuid: string | null;
    scanHashVersion?: number;
    contentHashVersion?: number;
    contentHashJournalVersion?: number;
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
        contentHashJournalVersion?: unknown;
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
    const contentHashJournalVersion =
        typeof obj.contentHashJournalVersion === "number"
            ? obj.contentHashJournalVersion
            : undefined;
    const exposeContentHashJournal =
        contentHashJournalVersion === CONTENT_HASH_JOURNAL_VERSION;
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
            listContentHashJournal?: unknown;
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
        if (exposeContentHashJournal) {
            const journal = parseContentHashJournal(e.listContentHashJournal);
            if (journal !== undefined) parsedEntry.listContentHashJournal = journal;
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
        ...(contentHashJournalVersion !== undefined ? { contentHashJournalVersion } : {}),
        importables,
    };
}

function parseContentHashJournal(
    value: unknown
): Record<string, ContentHashJournalEntry[]> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const result: Record<string, ContentHashJournalEntry[]> = {};
    for (const path in value as Record<string, unknown>) {
        const entries = (value as Record<string, unknown>)[path];
        if (!Array.isArray(entries)) return undefined;
        const parsed: ContentHashJournalEntry[] = [];
        for (const entry of entries) {
            if (entry === null || typeof entry !== "object") return undefined;
            const candidate = entry as { hash?: unknown; recordedAt?: unknown };
            if (
                typeof candidate.hash !== "string" ||
                typeof candidate.recordedAt !== "string"
            ) {
                return undefined;
            }
            parsed.push({ hash: candidate.hash, recordedAt: candidate.recordedAt });
        }
        result[path] = parsed.slice(-3);
    }
    return result;
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

function writeHouseLock(lockPath: string, lock: HouseLock): boolean {
    try {
        ensureParentDirs(lockPath);
        FileLib.write(lockPath, JSON.stringify(lock, null, 4), true);
        return true;
    } catch (_e) {
        return false;
    }
}

function canWriteContentHashJournal(lock: HouseLock): boolean {
    return (
        lock.contentHashJournalVersion === undefined ||
        lock.contentHashJournalVersion === CONTENT_HASH_JOURNAL_VERSION
    );
}

function seedContentHashJournalFromBaselines(
    lock: HouseLock,
    recordedAt: string
): boolean {
    let changed = false;
    for (const key in lock.importables) {
        const entry = lock.importables[key];
        if (entry.listContentHashes === undefined) continue;
        for (const basePath in entry.listContentHashes) {
            const existing = entry.listContentHashJournal?.[basePath];
            if (existing !== undefined && existing.length > 0) continue;
            entry.listContentHashJournal ??= {};
            entry.listContentHashJournal[basePath] = [
                { hash: entry.listContentHashes[basePath], recordedAt },
            ];
            changed = true;
        }
    }
    return changed;
}

export type HouseLockImportableUpdate = {
    importable: Importable;
    itemDependencies?: ItemDependencySnapshot;
    preserveListPaths?: readonly string[];
};

export type HouseLockActionListSeed = {
    importable: Importable;
    basePath: string;
    actions: readonly import("htsw/types").Action[];
    itemContent?: ItemFieldContent;
};

export function seedMissingHouseLockActionLists(
    importJsonPath: string,
    housingUuid: string,
    seeds: readonly HouseLockActionListSeed[]
): boolean {
    if (seeds.length === 0) return true;
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    if (lock.houseUuid !== null && lock.houseUuid !== housingUuid) return false;
    if (!canWriteContentHashJournal(lock)) return false;
    const recordedAt = new Date().toISOString();
    let changed = lock.contentHashJournalVersion !== CONTENT_HASH_JOURNAL_VERSION;
    if (seedContentHashJournalFromBaselines(lock, recordedAt)) changed = true;
    lock.houseUuid = housingUuid;
    lock.scanHashVersion = ACTION_LIST_SCAN_HASH_VERSION;
    lock.contentHashVersion = ACTION_LIST_CONTENT_HASH_VERSION;
    lock.contentHashJournalVersion = CONTENT_HASH_JOURNAL_VERSION;
    for (const seed of seeds) {
        const identity = importableIdentity(seed.importable);
        const key = importableKey(seed.importable.type, identity);
        let entry: HouseLockEntry;
        if (Object.prototype.hasOwnProperty.call(lock.importables, key)) {
            entry = lock.importables[key];
        } else {
            entry = {
                type: seed.importable.type,
                identity,
                hash: importableHash(seed.importable),
                listScanHashes: {},
                listContentHashes: {},
            };
            lock.importables[key] = entry;
        }
        entry.listScanHashes ??= {};
        entry.listContentHashes ??= {};
        const hasScan = Object.prototype.hasOwnProperty.call(
            entry.listScanHashes,
            seed.basePath
        );
        const hasContent = Object.prototype.hasOwnProperty.call(
            entry.listContentHashes,
            seed.basePath
        );
        if (hasScan && hasContent) {
            continue;
        }
        if (!hasScan) {
            entry.listScanHashes[seed.basePath] = actionListScanHashFromActions(
                seed.actions
            );
        }
        if (!hasContent) {
            const contentHash = actionListContentHashFromActions(
                seed.actions,
                seed.itemContent
            );
            entry.listContentHashes[seed.basePath] = contentHash;
            entry.listContentHashJournal ??= {};
            entry.listContentHashJournal[seed.basePath] = [
                { hash: contentHash, recordedAt },
            ];
        }
        changed = true;
    }
    return !changed || writeHouseLock(path, lock);
}

export function upsertHouseLockImportable(
    importJsonPath: string,
    housingUuid: string,
    importable: Importable,
    itemDependencies?: ItemDependencySnapshot
): boolean {
    return upsertHouseLockImportables(importJsonPath, housingUuid, [
        { importable, itemDependencies },
    ]);
}

export function upsertHouseLockImportables(
    importJsonPath: string,
    housingUuid: string,
    updates: readonly HouseLockImportableUpdate[]
): boolean {
    if (updates.length === 0) return true;
    const path = houseLockPathForImportJson(importJsonPath);
    const lock = readHouseLock(importJsonPath) ?? emptyHouseLock(housingUuid);
    if (!canWriteContentHashJournal(lock)) return false;
    const recordedAt = new Date().toISOString();
    seedContentHashJournalFromBaselines(lock, recordedAt);
    lock.houseUuid = housingUuid;
    lock.scanHashVersion = ACTION_LIST_SCAN_HASH_VERSION;
    lock.contentHashVersion = ACTION_LIST_CONTENT_HASH_VERSION;
    lock.contentHashJournalVersion = CONTENT_HASH_JOURNAL_VERSION;
    for (const update of updates) {
        const importable = update.importable;
        const identity = importableIdentity(importable);
        const listScanHashes: Record<string, string> = {};
        const listContentHashes: Record<string, string> = {};
        const dependencyIndex = itemDependencyIndexFor(importable);
        const itemContent =
            dependencyIndex === undefined
                ? undefined
                : (
                      owner: import("htsw/types").Action | import("htsw/types").Condition,
                      property: string
                  ) => dependencyIndex.fieldContent(owner, property);
        for (const { basePath, actions } of actionListsOfImportable(importable)) {
            listScanHashes[basePath] = actionListScanHashFromActions(actions);
            listContentHashes[basePath] = actionListContentHashFromActions(
                actions,
                itemContent
            );
        }
        const key = importableKey(importable.type, identity);
        const previous = Object.prototype.hasOwnProperty.call(lock.importables, key)
            ? lock.importables[key]
            : undefined;
        const listContentHashJournal = {
            ...(previous?.listContentHashJournal ?? {}),
        };
        for (const basePath in listContentHashes) {
            const hash = listContentHashes[basePath];
            const entries = (listContentHashJournal[basePath] ?? []).slice();
            if (entries.length === 0 || entries[entries.length - 1].hash !== hash) {
                entries.push({ hash, recordedAt });
            }
            listContentHashJournal[basePath] = entries.slice(-3);
        }
        for (const basePath of update.preserveListPaths ?? []) {
            const scanHash = previous?.listScanHashes?.[basePath];
            const contentHash = previous?.listContentHashes?.[basePath];
            if (scanHash !== undefined) listScanHashes[basePath] = scanHash;
            if (contentHash !== undefined) listContentHashes[basePath] = contentHash;
            if (previous?.listContentHashJournal?.[basePath] !== undefined) {
                listContentHashJournal[basePath] =
                    previous.listContentHashJournal[basePath];
            }
        }
        lock.importables[key] = {
            type: importable.type,
            identity,
            hash: importableHash(importable),
            listScanHashes,
            listContentHashes,
            listContentHashJournal,
            ...(update.itemDependencies !== undefined
                ? { itemDependencies: update.itemDependencies }
                : {}),
        };
    }
    return writeHouseLock(path, lock);
}
