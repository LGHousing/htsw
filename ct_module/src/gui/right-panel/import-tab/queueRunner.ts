/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { buildCacheStatusRow } from "../../../importCache/status";
import { recordHouseScan } from "../../../importCache/cache";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { listAllCommandNames } from "../../../importables/commands/listCommands";
import { knownEventNames } from "../../../importables/events/listEvents";
import { runExportSession } from "../../../importables/export/session";
import {
    HOUSE_READABLE_TYPES,
    type HouseReadableType,
} from "../../../importables/export/readers";
import { listAllFunctionNames } from "../../../importables/functions/listFunctions";
import { listAllGroupNames } from "../../../importables/groups/listGroups";
import { importableIdentity, npcPosIdentity } from "../../../importables/identity";
import { listAllMenuNames } from "../../../importables/menus/listMenus";
import { listAllNpcs } from "../../../importables/npcs/listNpcs";
import { readProjectExportDestination } from "../../../importables/export/projectDestination";
import { listAllRegionNames } from "../../../importables/regions/listRegions";
import { listAllTeamNames } from "../../../importables/teams/listTeams";
import { exportHeldItem } from "../../../importables/items/export";
import { isTaskCancelled, TaskManager } from "../../../tasks/manager";
import type TaskContext from "../../../tasks/context";
import { cancelActiveTask } from "../../../tasks/activeTask";
import { runHousingSyncTask } from "../../../housingSync/taskRunner";
import { gmcOnImportStart, waitForCreativeMode } from "../../../housingSync/sideEffects";
import { parseImportJsonCurrent } from "../../parsing/parses";
import { setHousingUuid } from "../../state";
import { isHouseTrusted } from "../../state/trust";
import { holdAutoRunUntilReparse } from "../../autoRun";
import { showToast } from "../../toast";
import { runImportQueueSession } from "./taskController";
import {
    completeQueueRows,
    expandBulkQueueRow,
    getQueue,
    isBulkQueueRowExpanded,
    isRestoredQueueRow,
    makeImportableQueueRow,
    setQueueRowStatus,
    type QueueRow,
    type QueueRowInput,
    type BulkFilter,
    type QueueOp,
} from "./queue";

export type QueueRunState = "idle" | "running" | "paused";
export type QueueStartOptions = { autoRun?: boolean };
type QueueSessionFailure = { key: string; error: string };
export type QueueSessionResult = {
    completedKeys: string[];
    failed: QueueSessionFailure[];
    cancelled?: boolean;
    parseError?: boolean;
};

export type QueueRunnerDependencies = {
    currentHouse(ctx: TaskContext): Promise<string>;
    beforeFirstImport(ctx: TaskContext): Promise<void>;
    expandBulk(
        ctx: TaskContext,
        row: QueueRow,
        currentHouse: string
    ): Promise<readonly QueueRowInput[]>;
    runImport(
        ctx: TaskContext,
        rows: readonly QueueRow[],
        currentHouse: string
    ): Promise<QueueSessionResult>;
    runExport(
        ctx: TaskContext,
        rows: readonly QueueRow[],
        currentHouse: string
    ): Promise<QueueSessionResult>;
    scheduleDone(callback: () => void): void;
};

let state: QueueRunState = "idle";
let pauseRequested = false;

export function queueRunState(): QueueRunState {
    return state;
}
export function isQueueRunning(): boolean {
    return state === "running";
}
export function isQueuePaused(): boolean {
    return state === "paused";
}

function isRunnable(row: QueueRow, house: string, autoRun: boolean): boolean {
    return (
        row.status === "queued" &&
        (row.house === null || row.house === house) &&
        (!autoRun || !isRestoredQueueRow(row.key))
    );
}

export function headRunnableQueueRow(
    currentHouse: string,
    options: QueueStartOptions = {}
): QueueRow | null {
    const autoRun = options.autoRun === true;
    for (const row of getQueue()) {
        if (!isRunnable(row, currentHouse, autoRun)) continue;
        if (row.target.kind === "bulk" && isBulkQueueRowExpanded(row.key)) continue;
        return row;
    }
    return null;
}

export function queueSessionFromHead(
    head: QueueRow,
    currentHouse: string,
    options: QueueStartOptions = {}
): QueueRow[] {
    if (head.target.kind !== "importable") return [];
    const queue = getQueue();
    const start = queue.findIndex((row) => row.key === head.key);
    if (start < 0) return [];
    const rows: QueueRow[] = [];
    for (let i = start; i < queue.length; i++) {
        const row = queue[i];
        if (
            row.target.kind !== "importable" ||
            !isRunnable(row, currentHouse, options.autoRun === true) ||
            row.op !== head.op ||
            row.path !== head.path ||
            row.house !== head.house
        ) {
            break;
        }
        rows.push(row);
    }
    return rows;
}

function resetSessionRows(rows: readonly QueueRow[]): void {
    const head = rows[0];
    for (const current of getQueue()) {
        if (
            current.target.kind === "importable" &&
            current.op === head.op &&
            current.path === head.path &&
            current.house === head.house &&
            current.status === "running"
        ) {
            setQueueRowStatus(current.key, "queued");
        }
    }
}

function applySessionResult(
    rows: readonly QueueRow[],
    result: QueueSessionResult,
    scheduleDone: (callback: () => void) => void
): boolean {
    const completed = new Set(result.completedKeys);
    const failed = new Map(result.failed.map((failure) => [failure.key, failure.error]));
    for (const [key, error] of failed) setQueueRowStatus(key, "failed", error);
    for (const row of rows) {
        if (!failed.has(row.key) && !completed.has(row.key)) {
            setQueueRowStatus(row.key, "queued");
        }
    }
    if (completed.size > 0) {
        scheduleDone(() => completeQueueRows(Array.from(completed)));
    }
    return failed.size > 0;
}

export async function drainQueue(
    ctx: TaskContext,
    dependencies: QueueRunnerDependencies,
    options: QueueStartOptions = {}
): Promise<QueueRunState> {
    const currentHouse = await dependencies.currentHouse(ctx);
    let preparedImport = false;
    for (;;) {
        ctx.checkCancelled();
        const head = headRunnableQueueRow(currentHouse, options);
        if (head === null) return "idle";
        if (head.target.kind === "bulk") {
            let children: readonly QueueRowInput[];
            try {
                children = await dependencies.expandBulk(ctx, head, currentHouse);
            } catch (error) {
                if (isTaskCancelled(error)) return "paused";
                const message = error instanceof Error ? error.message : String(error);
                setQueueRowStatus(head.key, "failed", message);
                if (head.op === "import") return "idle";
                continue;
            }
            const inserted = expandBulkQueueRow(head.key, children);
            if (inserted.length === 0) {
                showToast(`${head.target.label}: nothing to do`, 0xffe5bc4b);
            }
            continue;
        }

        const session = queueSessionFromHead(head, currentHouse, options);
        if (session.length === 0) return "idle";
        for (const row of session) setQueueRowStatus(row.key, "running");
        if (head.op === "import" && !preparedImport) {
            await dependencies.beforeFirstImport(ctx);
            preparedImport = true;
        }

        let result: QueueSessionResult;
        try {
            result =
                head.op === "import"
                    ? await dependencies.runImport(ctx, session, currentHouse)
                    : await dependencies.runExport(ctx, session, currentHouse);
        } catch (error) {
            if (isTaskCancelled(error)) {
                resetSessionRows(session);
                return "paused";
            }
            const message = error instanceof Error ? error.message : String(error);
            setQueueRowStatus(head.key, "failed", message);
            for (let i = 1; i < session.length; i++) {
                setQueueRowStatus(session[i].key, "queued");
            }
            if (head.op === "import") {
                ChatLib.chat(`&c[htsw] Import failed: ${String(error)}`);
                return "idle";
            }
            continue;
        }

        if (result.cancelled === true) {
            resetSessionRows(session);
            return "paused";
        }
        if (result.parseError === true) holdAutoRunUntilReparse();
        const failed = applySessionResult(session, result, (callback) =>
            dependencies.scheduleDone(callback)
        );
        if (head.op === "import" && failed) {
            showToast("Queue stopped after import failure", 0xffe85c5c, 8000);
            return "idle";
        }
    }
}

export function startQueue(options: QueueStartOptions = {}): boolean {
    if (state === "running" || TaskManager.isBusy()) return false;
    const eligible = getQueue().some(
        (row) =>
            row.status === "queued" && (!options.autoRun || !isRestoredQueueRow(row.key))
    );
    if (!eligible) return false;
    state = "running";
    pauseRequested = false;
    void runHousingSyncTask("queue", (ctx) =>
        drainQueue(ctx, defaultDependencies, options)
    )
        .then((next) => {
            state = next ?? (pauseRequested ? "paused" : "idle");
        })
        .catch((error: unknown) => {
            state = "idle";
            ChatLib.chat(`&c[htsw] Queue failed: ${String(error)}`);
            showToast(`Queue failed: ${String(error)}`, 0xffe85c5c, 8000);
        })
        .finally(() => {
            pauseRequested = false;
        });
    return true;
}

export function resumeQueue(): boolean {
    if (state !== "paused") return false;
    state = "idle";
    return startQueue();
}

export function pauseQueue(): "requested" | "forced" | null {
    if (state !== "running") return null;
    pauseRequested = true;
    return cancelActiveTask();
}
export function cancelQueue(): "requested" | "forced" | null {
    return pauseQueue();
}

type ListedNames = { names: string[]; labels?: Map<string, string> };

export function bulkFilterAllowed(op: QueueOp, filter: BulkFilter): boolean {
    if (filter === "all") return true;
    if (filter === "modified") return op === "import";
    if (filter === "new") return op === "export";
    return op === "export" || op === "read";
}

export function matchesBulkCacheState(
    filter: BulkFilter,
    state: "current" | "modified" | "unknown",
    trusted: boolean
): boolean {
    if (filter === "modified") return state !== "current";
    if (filter === "changed") return trusted && state === "modified";
    return true;
}

export function namesNotDeclared(
    liveNames: readonly string[],
    declaredNames: ReadonlySet<string>
): string[] {
    return liveNames.filter((name) => !declaredNames.has(name));
}

async function listHouseType(
    ctx: TaskContext,
    type: HouseReadableType
): Promise<ListedNames> {
    if (type === "FUNCTION") return { names: await listAllFunctionNames(ctx) };
    if (type === "MENU") return { names: await listAllMenuNames(ctx) };
    if (type === "REGION") return { names: await listAllRegionNames(ctx) };
    if (type === "COMMAND") return { names: await listAllCommandNames(ctx) };
    if (type === "EVENT") return { names: knownEventNames() };
    if (type === "TEAM") return { names: await listAllTeamNames(ctx) };
    if (type === "GROUP") return { names: await listAllGroupNames(ctx) };
    const entries = await listAllNpcs(ctx);
    const labels = new Map<string, string>();
    const names = entries.map((entry) => {
        const identity = npcPosIdentity(entry.pos);
        labels.set(identity, entry.name);
        return identity;
    });
    return { names, labels };
}

function selectedImportables(
    values: readonly Importable[],
    row: QueueRow,
    house: string,
    liveNames?: ReadonlySet<string>
): Importable[] {
    if (row.target.kind !== "bulk") return [];
    const type = row.target.scope.kind === "houseType" ? row.target.scope.type : null;
    const filter = row.target.filter;
    return values.filter((importable) => {
        if (type !== null && importable.type !== type) return false;
        const identity = importableIdentity(importable);
        if (liveNames !== undefined && !liveNames.has(identity)) return false;
        const status = buildCacheStatusRow(house, importable).state;
        return matchesBulkCacheState(filter, status, isHouseTrusted(house));
    });
}

async function expandBulkDefault(
    ctx: TaskContext,
    row: QueueRow,
    house: string
): Promise<readonly QueueRowInput[]> {
    if (row.target.kind !== "bulk") return [];
    if (!bulkFilterAllowed(row.op, row.target.filter)) {
        throw new Error(
            `The ${row.target.filter} filter is not valid for ${row.op} operations`
        );
    }
    const scopePath = row.target.scope.kind === "file" ? row.target.scope.path : row.path;
    const parsedEntry = await parseImportJsonCurrent(scopePath);
    const values = parsedEntry.parsed?.value ?? [];
    let selected: Array<{ type: Importable["type"]; identity: string; label: string }> =
        [];

    if (row.target.scope.kind === "houseType") {
        const type = row.target.scope.type;
        const listed = await listHouseType(ctx, type);
        recordHouseScan(house, type, listed.names, listed.labels);
        const live = new Set(listed.names);
        if (row.target.filter === "new") {
            const declared = new Set(
                values
                    .filter((importable) => importable.type === type)
                    .map(importableIdentity)
            );
            selected = namesNotDeclared(listed.names, declared).map((identity) => ({
                type,
                identity,
                label: listed.labels?.get(identity) ?? identity,
            }));
        } else if (row.op === "import") {
            selected = selectedImportables(values, row, house, live).map(
                (importable) => ({
                    type: importable.type,
                    identity: importableIdentity(importable),
                    label:
                        importable.type === "EVENT" ? importable.event : importable.name,
                })
            );
        } else if (row.target.filter === "changed") {
            selected = selectedImportables(values, row, house, live).map(
                (importable) => ({
                    type: importable.type,
                    identity: importableIdentity(importable),
                    label:
                        listed.labels?.get(importableIdentity(importable)) ??
                        importableIdentity(importable),
                })
            );
        } else {
            selected = listed.names.map((identity) => ({
                type,
                identity,
                label: listed.labels?.get(identity) ?? identity,
            }));
        }
    } else if (row.target.filter === "new") {
        const declaredByType = new Map<Importable["type"], Set<string>>();
        for (const importable of values) {
            let declared = declaredByType.get(importable.type);
            if (declared === undefined) {
                declared = new Set<string>();
                declaredByType.set(importable.type, declared);
            }
            declared.add(importableIdentity(importable));
        }
        for (const type of HOUSE_READABLE_TYPES) {
            const listed = await listHouseType(ctx, type);
            recordHouseScan(house, type, listed.names, listed.labels);
            const declared = declaredByType.get(type) ?? new Set<string>();
            for (const identity of namesNotDeclared(listed.names, declared)) {
                selected.push({
                    type,
                    identity,
                    label: listed.labels?.get(identity) ?? identity,
                });
            }
        }
    } else {
        selected = selectedImportables(values, row, house).map((importable) => ({
            type: importable.type,
            identity: importableIdentity(importable),
            label: importable.type === "EVENT" ? importable.event : importable.name,
        }));
    }

    return selected.map((target) =>
        makeImportableQueueRow({
            op: row.op,
            house: row.house,
            path: row.path,
            type: target.type,
            identity: target.identity,
            label: target.label,
            origin: "expansion",
            parentKey: row.key,
        })
    );
}

export async function runQueuedExportSession(
    ctx: TaskContext,
    rows: readonly QueueRow[],
    currentHouse: string,
    runSession: typeof runExportSession = runExportSession
): Promise<QueueSessionResult> {
    const first = rows[0];
    const batches = new Map<Importable["type"], QueueRow[]>();
    for (const row of rows) {
        if (row.target.kind !== "importable") continue;
        const group = batches.get(row.target.type) ?? [];
        group.push(row);
        batches.set(row.target.type, group);
    }
    const completedKeys: string[] = [];
    const failed: QueueSessionFailure[] = [];
    await runSession(
        ctx,
        first.op === "read"
            ? { kind: "cache", housingUuid: currentHouse, importJsonPath: first.path }
            : {
                  kind: "project",
                  project: readProjectExportDestination({
                      rootDir: directoryOf(first.path),
                      importJsonPath: first.path,
                  }),
              },
        Array.from(batches.entries()).map(([type, batchRows]) => ({
            type,
            reader: type === "ITEM" ? exportHeldItem : undefined,
            names:
                type === "ITEM"
                    ? undefined
                    : batchRows.map((row) =>
                          row.target.kind === "importable" ? row.target.identity : ""
                      ),
            queueRows: batchRows,
            onQueueRowFinished: (key: string, error?: string) => {
                if (error === undefined) completedKeys.push(key);
                else failed.push({ key, error });
            },
        }))
    );
    const itemRows = batches.get("ITEM") ?? [];
    for (const itemRow of itemRows) {
        if (completedKeys.indexOf(itemRow.key) < 0) completedKeys.push(itemRow.key);
    }
    return { completedKeys, failed };
}

function directoryOf(path: string): string {
    const normalized = path.split("\\").join("/");
    const slash = normalized.lastIndexOf("/");
    return slash <= 0 ? "." : normalized.substring(0, slash);
}

const defaultDependencies: QueueRunnerDependencies = {
    async currentHouse(ctx) {
        const uuid = await getCurrentHousingUuid(ctx);
        setHousingUuid(uuid);
        return uuid;
    },
    async beforeFirstImport(ctx) {
        gmcOnImportStart();
        if (!(await waitForCreativeMode(ctx))) {
            ChatLib.chat(
                "&e[htsw] Still not in creative after /gmc — item spawns may fail. Check your gamemode permissions on this plot."
            );
        }
    },
    expandBulk: expandBulkDefault,
    runImport: runImportQueueSession,
    runExport: runQueuedExportSession,
    scheduleDone(callback) {
        setTimeout(callback, 1500);
    },
};
