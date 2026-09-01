/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import type { HouseReadableType } from "../../../importables/export/readers";
import { importableIdentity } from "../../../importables/identity";
import { markGuiDirty } from "../../lib/dirty";
import { importableFilePaths } from "../../parsing/importablePaths";
import {
    canonicalPath,
    forEachCachedParse,
    getParseCacheRevision,
    type CachedParse,
} from "../../parsing/parses";

export type QueueOp = "import" | "export" | "read";
export type QueueStatus = "queued" | "running" | "failed" | "cancelled";
export type QueueOrigin = "user" | "autotrack" | "dependency" | "expansion";
export type BulkScope =
    { kind: "houseType"; type: HouseReadableType } | { kind: "file"; path: string };
export type BulkFilter = "all" | "modified" | "new" | "changed";
export type QueueTarget =
    | {
          kind: "importable";
          type: Importable["type"];
          identity: string;
          label: string;
      }
    | { kind: "bulk"; scope: BulkScope; filter: BulkFilter; label: string };

export type QueueRow = {
    key: string;
    op: QueueOp;
    house: string | null;
    path: string;
    target: QueueTarget;
    origin: QueueOrigin;
    status: QueueStatus;
    error: string | null;
    parentKey: string | null;
};
export type QueueRowInput = Omit<QueueRow, "key"> & { key?: string };
export type QueueAddResult =
    | { kind: "added"; row: QueueRow; message: string }
    | { kind: "duplicate"; row: QueueRow; existing: QueueRow; message: string }
    | { kind: "absorbed"; row: QueueRow; existing: QueueRow; message: string }
    | {
          kind: "alsoQueuedOtherDirection";
          row: QueueRow;
          existing: QueueRow;
          message: string;
      };
export type QueueRowBadge = { op: "import" | "export"; tooltip: string };

/** Temporary aliases for phase-2 consumers. */
type ImportableQueueItem = QueueRow & {
    target: Extract<QueueTarget, { kind: "importable" }>;
    operation: QueueOp;
    kind: "importable";
    sourcePath: string;
    destinationPath: string;
    housingUuid: string | null;
    identity: string;
    type: Importable["type"];
    label: string;
};
type BulkQueueItem = QueueRow & {
    target: Extract<QueueTarget, { kind: "bulk" }>;
    operation: QueueOp;
    kind: "importJson";
    sourcePath: string;
    destinationPath: string;
    housingUuid: string | null;
    label: string;
};
export type QueueItem = ImportableQueueItem | BulkQueueItem;
export type ImportQueueItem = QueueItem & { op: "import"; operation: "import" };
export type ExportQueueItem = ImportableQueueItem & {
    op: "export" | "read";
    operation: "export" | "read";
};

function canonicalScope(scope: BulkScope): BulkScope {
    return scope.kind === "file"
        ? { kind: "file", path: canonicalPath(scope.path) }
        : scope;
}

function targetKey(target: QueueTarget): string {
    if (target.kind === "importable") return `${target.type}:${target.identity}`;
    const scope =
        target.scope.kind === "houseType"
            ? `houseType:${target.scope.type}`
            : `file:${canonicalPath(target.scope.path)}`;
    return `${scope}:${target.filter}`;
}

export function queueRowKey(
    row: Pick<QueueRow, "op" | "house" | "path" | "target">
): string {
    return `${row.op}|${row.house ?? ""}|${canonicalPath(row.path)}|${targetKey(row.target)}`;
}

function withCompatibilityFields(row: QueueRow): QueueItem {
    const common = {
        ...row,
        operation: row.op,
        sourcePath: row.path,
        destinationPath: row.path,
        housingUuid: row.house,
    };
    if (row.target.kind === "importable") {
        return {
            ...common,
            target: row.target,
            kind: "importable",
            identity: row.target.identity,
            type: row.target.type,
            label: row.target.label,
        };
    }
    return {
        ...common,
        target: row.target,
        kind: "importJson",
        label: row.target.label,
    };
}

function normalizeQueueRow(input: QueueRowInput | QueueRow): QueueItem {
    const target: QueueTarget =
        input.target.kind === "bulk"
            ? { ...input.target, scope: canonicalScope(input.target.scope) }
            : { ...input.target };
    const row: QueueRow = {
        key: "",
        op: input.op,
        house: input.house,
        path: canonicalPath(input.path),
        target,
        origin: input.origin,
        status: input.status,
        error: input.status === "failed" ? input.error : null,
        parentKey: input.parentKey,
    };
    row.key = queueRowKey(row);
    return withCompatibilityFields(row);
}

export function makeImportableQueueRow(args: {
    op: QueueOp;
    house: string | null;
    path: string;
    type: Importable["type"];
    identity: string;
    label?: string;
    origin?: QueueOrigin;
    parentKey?: string | null;
}): QueueItem {
    return normalizeQueueRow({
        op: args.op,
        house: args.house,
        path: args.path,
        target: {
            kind: "importable",
            type: args.type,
            identity: args.identity,
            label: args.label ?? args.identity,
        },
        origin: args.origin ?? "user",
        status: "queued",
        error: null,
        parentKey: args.parentKey ?? null,
    });
}

export function makeBulkQueueRow(args: {
    op: QueueOp;
    house: string | null;
    path: string;
    scope: BulkScope;
    filter: BulkFilter;
    label: string;
    origin?: QueueOrigin;
    parentKey?: string | null;
}): QueueItem {
    return normalizeQueueRow({
        op: args.op,
        house: args.house,
        path: args.path,
        target: {
            kind: "bulk",
            scope: args.scope,
            filter: args.filter,
            label: args.label,
        },
        origin: args.origin ?? "user",
        status: "queued",
        error: null,
        parentKey: args.parentKey ?? null,
    });
}

let items: QueueItem[] = [];
const byKey = new Map<string, QueueItem>();
const autoTrackedKeys = new Set<string>();
const restoredKeys = new Set<string>();
let sessionKeys: Set<string> | null = null;

function queueChanged(): void {
    markGuiDirty();
}
function rebuildLookup(): void {
    byKey.clear();
    for (let i = 0; i < items.length; i++) byKey.set(items[i].key, items[i]);
}
function sameWorkWithoutOp(left: QueueRow, right: QueueRow): boolean {
    return (
        left.house === right.house &&
        left.path === right.path &&
        targetKey(left.target) === targetKey(right.target)
    );
}
function findCoveringWrite(row: QueueRow): QueueItem | null {
    if (row.op !== "read") return null;
    for (let i = 0; i < items.length; i++) {
        const existing = items[i];
        if (
            (existing.op === "export" || existing.op === "import") &&
            sameWorkWithoutOp(existing, row)
        ) {
            return existing;
        }
    }
    return null;
}
function findOtherDirection(row: QueueRow): QueueItem | null {
    if (row.op !== "import" && row.op !== "export") return null;
    const other = row.op === "import" ? "export" : "import";
    for (let i = 0; i < items.length; i++) {
        const existing = items[i];
        if (existing.op === other && sameWorkWithoutOp(existing, row)) return existing;
    }
    return null;
}

export function addToQueue(input: QueueRowInput | QueueRow): QueueAddResult {
    const row = normalizeQueueRow(input);
    const duplicate = byKey.get(row.key);
    if (duplicate !== undefined) {
        return {
            kind: "duplicate",
            row,
            existing: duplicate,
            message: `${row.target.label} is already queued`,
        };
    }
    const covering = findCoveringWrite(row);
    if (covering !== null) {
        return {
            kind: "absorbed",
            row,
            existing: covering,
            message: `${row.target.label} is already queued for ${covering.op}`,
        };
    }
    const otherDirection = findOtherDirection(row);
    items = items.concat([row]);
    byKey.set(row.key, row);
    queueChanged();
    if (otherDirection !== null) {
        return {
            kind: "alsoQueuedOtherDirection",
            row,
            existing: otherDirection,
            message: `${row.target.label} is also queued for ${otherDirection.op}`,
        };
    }
    return { kind: "added", row, message: `${row.target.label} queued` };
}
export const addQueueRow = addToQueue;

export function getQueue(): readonly QueueItem[] {
    return items;
}
export function getQueueRow(key: string): QueueItem | null {
    return byKey.get(key) ?? null;
}
export function getQueueLength(): number {
    return items.length;
}
export function queueRowsAlsoQueuedOtherDirection(key: string): boolean {
    const row = byKey.get(key);
    return row !== undefined && findOtherDirection(row) !== null;
}
export function getQueueRowBadge(rowOrKey: QueueRow | string): QueueRowBadge | null {
    const row = typeof rowOrKey === "string" ? (byKey.get(rowOrKey) ?? null) : rowOrKey;
    if (row === null) return null;
    const other = findOtherDirection(row);
    if (other === null) return null;
    return {
        op: other.op as "import" | "export",
        tooltip: `also queued for ${other.op}`,
    };
}

export function setQueueRowStatus(
    key: string,
    status: QueueStatus,
    error: string | null = null
): boolean {
    const current = byKey.get(key);
    if (current === undefined) return false;
    const next = withCompatibilityFields({
        ...current,
        status,
        error: status === "failed" ? error : null,
    });
    items = items.map((row) => (row.key === key ? next : row));
    byKey.set(key, next);
    queueChanged();
    return true;
}
export function retryQueueRow(key: string): boolean {
    const row = byKey.get(key);
    if (row === undefined || (row.status !== "failed" && row.status !== "cancelled")) {
        return false;
    }
    return setQueueRowStatus(key, "queued");
}

function removeRows(keys: ReadonlySet<string>): boolean {
    if (keys.size === 0) return false;
    const before = items.length;
    items = items.filter((row) => !keys.has(row.key));
    if (items.length === before) return false;
    for (const key of keys) {
        byKey.delete(key);
        autoTrackedKeys.delete(key);
        restoredKeys.delete(key);
        sessionKeys?.delete(key);
    }
    return true;
}
function removeEmptyParents(): void {
    for (;;) {
        const parentsWithChildren = new Set<string>();
        for (let i = 0; i < items.length; i++) {
            if (items[i].parentKey !== null)
                parentsWithChildren.add(items[i].parentKey as string);
        }
        const emptyParents = new Set<string>();
        for (let i = 0; i < items.length; i++) {
            const row = items[i];
            if (
                row.target.kind === "bulk" &&
                row.status === "running" &&
                !parentsWithChildren.has(row.key)
            ) {
                emptyParents.add(row.key);
            }
        }
        if (!removeRows(emptyParents)) return;
    }
}
export function removeQueueRow(key: string): boolean {
    const removed = removeRows(new Set([key]));
    if (!removed) return false;
    removeEmptyParents();
    rebuildLookup();
    queueChanged();
    return true;
}
export function dismissQueueRow(key: string): boolean {
    const row = byKey.get(key);
    if (row === undefined || row.status === "running") return false;
    return removeQueueRow(key);
}
export function completeQueueRows(keys: readonly string[]): void {
    if (!removeRows(new Set(keys))) return;
    removeEmptyParents();
    rebuildLookup();
    queueChanged();
}
export function expandBulkQueueRow(
    parentKey: string,
    children: readonly QueueRowInput[]
): QueueRow[] {
    const parentIndex = items.findIndex((row) => row.key === parentKey);
    if (parentIndex < 0) return [];
    const parent = items[parentIndex];
    if (parent.target.kind !== "bulk") return [];
    const existingChildren = items.filter((row) => row.parentKey === parentKey);
    if (existingChildren.length > 0) return existingChildren;
    const inserted: QueueItem[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < children.length; i++) {
        const child = normalizeQueueRow({ ...children[i], parentKey });
        if (byKey.has(child.key) || seen.has(child.key)) continue;
        seen.add(child.key);
        inserted.push(child);
    }
    if (inserted.length === 0) {
        completeQueueRows([parentKey]);
        return [];
    }
    const runningParent = withCompatibilityFields({
        ...parent,
        status: "running",
        error: null,
    });
    items = items
        .slice(0, parentIndex)
        .concat([runningParent], inserted, items.slice(parentIndex + 1));
    rebuildLookup();
    queueChanged();
    return inserted;
}
export function isBulkQueueRowExpanded(key: string): boolean {
    const parent = byKey.get(key);
    if (parent?.target.kind !== "bulk") return false;
    for (let i = 0; i < items.length; i++) {
        if (items[i].parentKey === key) return true;
    }
    return false;
}
export function clearQueue(): void {
    if (items.length === 0 && sessionKeys === null) return;
    items = [];
    byKey.clear();
    autoTrackedKeys.clear();
    restoredKeys.clear();
    sessionKeys = null;
    queueChanged();
}

export function isRestoredQueueRow(key: string): boolean {
    return restoredKeys.has(key);
}
export const isRestoredQueueItem = isRestoredQueueRow;
export function markQueueRowRedetected(key: string): void {
    if (restoredKeys.delete(key)) queueChanged();
}
export function captureQueueItems(): QueueRow[] {
    const out: QueueRow[] = [];
    for (let i = 0; i < items.length; i++) {
        const row = items[i];
        if (autoTrackedKeys.has(row.key)) continue;
        out.push({
            key: row.key,
            op: row.op,
            house: row.house,
            path: row.path,
            target: row.target,
            origin: row.origin,
            status: row.status,
            error: row.error,
            parentKey: row.parentKey,
        });
    }
    return out;
}
export function restoreQueueItems(saved: readonly QueueRowInput[]): void {
    for (let i = 0; i < saved.length; i++) {
        const input = saved[i];
        const restored = normalizeQueueRow({
            ...input,
            status: input.status === "running" ? "queued" : input.status,
            error: input.status === "failed" ? input.error : null,
        });
        const result = addToQueue(restored);
        if (result.kind === "added" || result.kind === "alsoQueuedOtherDirection") {
            restoredKeys.add(result.row.key);
        }
    }
}
export function reconcileAutoTrackedQueue(
    desiredItems: readonly QueueRow[],
    removeStale = true
): ReadonlySet<string> {
    const desired = desiredItems.map((row) =>
        normalizeQueueRow({ ...row, origin: "autotrack" })
    );
    const desiredKeys = new Set(desired.map((row) => row.key));
    if (removeStale) {
        const stale = new Set<string>();
        for (const key of autoTrackedKeys) {
            const row = byKey.get(key);
            if (
                !desiredKeys.has(key) &&
                row?.status !== "running" &&
                !sessionKeys?.has(key)
            ) {
                stale.add(key);
            }
        }
        if (removeRows(stale)) {
            rebuildLookup();
            queueChanged();
        }
    }
    const added = new Set<string>();
    for (let i = 0; i < desired.length; i++) {
        const row = desired[i];
        if (restoredKeys.delete(row.key)) autoTrackedKeys.add(row.key);
        const result = addToQueue(row);
        if (result.kind !== "added" && result.kind !== "alsoQueuedOtherDirection")
            continue;
        autoTrackedKeys.add(result.row.key);
        added.add(result.row.key);
    }
    return added;
}

// Temporary session/display compatibility until the phase-2 UI migration.
export function beginQueueSession(keys?: readonly string[]): void {
    sessionKeys = new Set(keys ?? items.map((row) => row.key));
    queueChanged();
}
export function endQueueSession(removeSessionItems: boolean): void {
    if (sessionKeys === null) return;
    const keys = sessionKeys;
    sessionKeys = null;
    if (removeSessionItems) removeRows(keys);
    rebuildLookup();
    queueChanged();
}
export function isQueueSessionItem(key: string): boolean {
    return sessionKeys?.has(key) ?? false;
}
export function queueDisplayGroups(): {
    active: QueueItem[];
    pending: QueueItem[];
    showDivider: boolean;
} {
    if (sessionKeys === null)
        return { active: items.slice(), pending: [], showDivider: false };
    const active: QueueItem[] = [];
    const pending: QueueItem[] = [];
    for (let i = 0; i < items.length; i++) {
        (sessionKeys.has(items[i].key) ? active : pending).push(items[i]);
    }
    return { active, pending, showDivider: pending.length > 0 };
}
export function queueItemKey(item: QueueRow): string {
    return item.key || queueRowKey(item);
}
export function queueItemProgressPath(item: QueueRow): string | null {
    return item.path;
}
export function isImportQueueItem(item: QueueRow): item is ImportQueueItem {
    return item.op === "import";
}
export function getQueuedItemKey(item: QueueRow): string | null {
    const key = queueRowKey(item);
    return byKey.has(key) ? key : null;
}
export function isQueueItemQueued(item: QueueRow): boolean {
    return getQueuedItemKey(item) !== null;
}
export function addSessionQueueItem(item: QueueRow): void {
    const result = addToQueue({ ...item, origin: "dependency" });
    const row =
        result.kind === "absorbed" || result.kind === "duplicate"
            ? result.existing
            : result.row;
    sessionKeys?.add(row.key);
    queueChanged();
}
export function removeFromQueueKey(key: string): void {
    removeQueueRow(key);
}
export function removeFromQueue(item: QueueRow): void {
    removeQueueRow(queueRowKey(item));
}
export function toggleQueue(item: QueueRow): boolean {
    const key = queueRowKey(item);
    if (byKey.has(key)) {
        removeQueueRow(key);
        return false;
    }
    const result = addToQueue(item);
    return result.kind === "added" || result.kind === "alsoQueuedOtherDirection";
}

export function queueItemsForPath(
    filePath: string,
    importJsonPath?: string | null
): QueueItem[] {
    return findImportableQueueItems(canonicalPath(filePath), importJsonPath);
}
let queueItemsCacheRev = -1;
const queueItemsCache = new Map<string, QueueItem[]>();
export function queueItemsCacheSize(): number {
    return queueItemsCache.size;
}
function findImportableQueueItems(
    target: string,
    importJsonPath?: string | null
): QueueItem[] {
    const rev = getParseCacheRevision();
    if (rev !== queueItemsCacheRev) {
        queueItemsCache.clear();
        queueItemsCacheRev = rev;
    }
    const scope = importJsonPath ? canonicalPath(importJsonPath) : "";
    const cacheKey = `${scope}\n${target}`;
    const cached = queueItemsCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const out: QueueItem[] = [];
    const visit = (entry: CachedParse): void => {
        if (entry.parsed === null) return;
        for (const imp of entry.parsed.value) {
            if (!importableFilePaths(imp).some((path) => canonicalPath(path) === target))
                continue;
            out.push(makeImportableQueueItem(imp, entry.canonicalPath));
        }
    };
    if (scope === "") forEachCachedParse(visit);
    else
        forEachCachedParse((entry) => {
            if (entry.canonicalPath === scope) visit(entry);
        });
    queueItemsCache.set(cacheKey, out);
    return out;
}
function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}
export function makeImportableQueueItem(
    imp: Importable,
    declaringImportJson: string
): ImportQueueItem {
    return makeImportableQueueRow({
        op: "import",
        house: null,
        path: declaringImportJson,
        type: imp.type,
        identity: importableIdentity(imp),
        label: importableLabel(imp),
    }) as ImportQueueItem;
}
export function makeExportQueueItem(
    operation: "export" | "read",
    type: Importable["type"],
    identity: string,
    destinationPath: string,
    housingUuid: string | null,
    label: string = identity
): ExportQueueItem {
    return makeImportableQueueRow({
        op: operation,
        house: housingUuid,
        path: destinationPath,
        type,
        identity,
        label,
    }) as ExportQueueItem;
}
