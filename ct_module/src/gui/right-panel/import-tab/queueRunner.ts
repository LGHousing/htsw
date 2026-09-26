/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import {
    emitBridgeEvent,
    finishBridgeRun,
    rejectBridgeRun,
    setBridgeOperation,
} from "../../../bridge/status";

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
import {
    importableIdentity,
    npcPosIdentity,
    parseNpcPosIdentity,
} from "../../../importables/identity";
import { listAllMenuNames } from "../../../importables/menus/listMenus";
import { listAllNpcs } from "../../../importables/npcs/listNpcs";
import { readProjectExportDestination } from "../../../importables/export/projectDestination";
import { listAllRegionNames } from "../../../importables/regions/listRegions";
import { listAllTeamNames } from "../../../importables/teams/listTeams";
import { exportHeldItem } from "../../../importables/items/export";
import { beginProjectRun, finishProjectRun } from "../../../prune/projectRun";
import { setTaskActivity } from "../../../tasks/activity";
import { shortPath } from "../../lib/pathDisplay";
import { isTaskCancelled, TaskManager } from "../../../tasks/manager";
import type TaskContext from "../../../tasks/context";
import { cancelActiveTask } from "../../../tasks/activeTask";
import { runHousingSyncTask } from "../../../housingSync/taskRunner";
import { gmcOnImportStart, waitForCreativeMode } from "../../../housingSync/sideEffects";
import { parseImportJsonCurrent } from "../../parsing/parses";
import { setHousingUuid } from "../../state";
import { getNewExportTarget } from "../../state/newExportTarget";
import { isHouseTrusted } from "../../state/trust";
import { holdAutoRunUntilReparse } from "../../autoRun";
import { openAnswerableConflictPrompt } from "../../popovers/conflictPrompt";
import { showToast } from "../../toast";
import { runImportQueueSession } from "./taskController";
import { formatElapsedSeconds } from "./elapsed";
import {
    completeQueueRows,
    expandBulkQueueRow,
    getQueue,
    getQueueRow,
    isBulkQueueRowExpanded,
    isProjectQueueRow,
    isRestoredQueueRow,
    isUnfinishedProjectRow,
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
    cancelledKeys?: string[];
    completionHooks?: Array<{ keys: string[]; callback: () => void }>;
};

type CompletionHook = { remaining: Set<string>; callback: () => void };
export type QueueRunTally = { completed: number; failed: number; reason?: string };
const completionHooks: CompletionHook[] = [];

export function onQueueRowsCompleted(
    keys: readonly string[],
    callback: () => void
): void {
    const hook = { remaining: new Set(keys), callback };
    if (hook.remaining.size === 0) callback();
    else completionHooks.push(hook);
}

function fireQueueRowsCompleted(keys: ReadonlySet<string>): void {
    for (let i = completionHooks.length - 1; i >= 0; i--) {
        const hook = completionHooks[i];
        for (const key of keys) hook.remaining.delete(key);
        if (hook.remaining.size > 0) continue;
        completionHooks.splice(i, 1);
        hook.callback();
    }
}

export type QueueRunnerDependencies = {
    currentHouse(ctx: TaskContext): Promise<string>;
    beforeFirstImport(ctx: TaskContext): Promise<void>;
    expandBulk(
        ctx: TaskContext,
        row: QueueRow,
        currentHouse: string
    ): Promise<readonly QueueRowInput[]>;
    /** Runs before a project row is expanded into its importables. */
    beginProject(ctx: TaskContext, row: QueueRow, currentHouse: string): Promise<void>;
    /**
     * Runs once every importable of a project row is done. Throwing fails the
     * row and stops the queue, like a failed import.
     */
    finishProject(ctx: TaskContext, row: QueueRow, currentHouse: string): Promise<void>;
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
const runEndedListeners: Array<(state: QueueRunState) => void> = [];

export function onQueueRunEnded(listener: (state: QueueRunState) => void): () => void {
    runEndedListeners.push(listener);
    return () => {
        const index = runEndedListeners.indexOf(listener);
        if (index >= 0) runEndedListeners.splice(index, 1);
    };
}

function notifyQueueRunEnded(): void {
    const listeners = runEndedListeners.slice();
    for (let i = 0; i < listeners.length; i++) listeners[i](state);
}

export function queueRunState(): QueueRunState {
    return state;
}
export function isQueueRunning(): boolean {
    return state === "running";
}
export function isQueuePaused(): boolean {
    return state === "paused";
}
export function isQueueCancellationPending(): boolean {
    return state === "running" && pauseRequested;
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

// Completed rows stay "running" until scheduleDone removes them, so the
// done state stays visible briefly. They are no longer part of any session.
// Held by row object: a row removed and queued again under the same key is
// a new object, so it is neither skipped nor removed by the old completion.
const awaitingRemoval = new WeakSet<QueueRow>();

/** Where a bulk row's work comes from, for the activity line. */
function bulkSource(row: QueueRow): string {
    if (row.target.kind !== "bulk") return row.target.label;
    return row.target.scope.kind === "file" ? shortPath(row.target.scope.path) : "the house";
}

/** A project row for this house whose importables are all done. */
function projectRowToFinish(currentHouse: string): QueueRow | null {
    const queue = getQueue();
    for (const row of queue) {
        if (row.status !== "running" || !isProjectQueueRow(row)) continue;
        if (awaitingRemoval.has(row)) continue;
        if (row.house !== null && row.house !== currentHouse) continue;
        // Children waiting for removal are done too.
        const pending = queue.some(
            (child) => child.parentKey === row.key && !awaitingRemoval.has(child)
        );
        if (!pending) return row;
    }
    return null;
}

/** False when the queue should stop. */
async function finishProjectRow(
    ctx: TaskContext,
    dependencies: QueueRunnerDependencies,
    row: QueueRow,
    currentHouse: string,
    tally?: QueueRunTally
): Promise<boolean> {
    setBridgeOperation(row.op);
    setTaskActivity(`Finishing ${shortPath(row.path)}`);
    try {
        await dependencies.finishProject(ctx, row, currentHouse);
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        setQueueRowStatus(row.key, "failed", message);
        if (tally !== undefined) {
            tally.failed++;
            tally.reason ??= message;
        }
        ChatLib.chat(`&c[htsw] ${row.target.label} failed: ${message}`);
        return false;
    }
    const finished = getQueueRow(row.key);
    if (finished !== null) {
        awaitingRemoval.add(finished);
        dependencies.scheduleDone(() => {
            if (getQueueRow(finished.key) === finished) completeQueueRows([finished.key]);
        });
    }
    return true;
}

/** The session's rows plus any dependency rows it added or pulled in. */
function runningSessionRows(rows: readonly QueueRow[]): QueueRow[] {
    const head = rows[0];
    return getQueue().filter(
        (current) =>
            current.target.kind === "importable" &&
            current.op === head.op &&
            current.path === head.path &&
            current.house === head.house &&
            current.status === "running" &&
            !awaitingRemoval.has(current)
    );
}

function resetSessionRows(rows: readonly QueueRow[]): void {
    for (const current of runningSessionRows(rows)) {
        setQueueRowStatus(current.key, "queued");
    }
}

function applySessionResult(
    rows: readonly QueueRow[],
    result: QueueSessionResult,
    scheduleDone: (callback: () => void) => void,
    tally?: QueueRunTally
): boolean {
    const completed = new Set(result.completedKeys);
    const failed = new Map(result.failed.map((failure) => [failure.key, failure.error]));
    for (const [key, error] of failed) setQueueRowStatus(key, "failed", error);
    if (tally !== undefined) {
        tally.completed += completed.size;
        tally.failed += failed.size;
        if (result.failed.length > 0) tally.reason ??= result.failed[0].error;
    }
    const cancelled = new Set(result.cancelledKeys ?? []);
    for (const key of cancelled) {
        setQueueRowStatus(key, "cancelled", "Cancelled for conflict review");
    }
    const done: QueueRow[] = [];
    for (const key of completed) {
        const row = getQueueRow(key);
        if (row === null) continue;
        awaitingRemoval.add(row);
        done.push(row);
    }
    resetSessionRows(rows);
    for (const hook of result.completionHooks ?? []) {
        onQueueRowsCompleted(hook.keys, hook.callback);
    }
    fireQueueRowsCompleted(completed);
    if (done.length > 0) {
        scheduleDone(() =>
            completeQueueRows(
                done.filter((row) => getQueueRow(row.key) === row).map((row) => row.key)
            )
        );
    }
    return failed.size > 0;
}

export async function drainQueue(
    ctx: TaskContext,
    dependencies: QueueRunnerDependencies,
    options: QueueStartOptions = {},
    tally?: QueueRunTally
): Promise<QueueRunState> {
    try {
        return await drainQueueInner(ctx, dependencies, options, tally);
    } finally {
        setTaskActivity(null);
    }
}

async function drainQueueInner(
    ctx: TaskContext,
    dependencies: QueueRunnerDependencies,
    options: QueueStartOptions,
    tally?: QueueRunTally
): Promise<QueueRunState> {
    setTaskActivity("Checking which house you're in");
    const currentHouse = await dependencies.currentHouse(ctx);
    let preparedImport = false;
    for (;;) {
        ctx.checkCancelled();
        setTaskActivity(null);
        const finishing = projectRowToFinish(currentHouse);
        if (finishing !== null) {
            try {
                const proceed = await finishProjectRow(
                    ctx,
                    dependencies,
                    finishing,
                    currentHouse,
                    tally
                );
                if (!proceed) return "idle";
            } catch (error) {
                if (isTaskCancelled(error)) return "paused";
                throw error;
            }
            continue;
        }
        const head = headRunnableQueueRow(currentHouse, options);
        if (head === null) return "idle";
        setBridgeOperation(head.op);
        if (head.target.kind === "bulk") {
            let children: readonly QueueRowInput[];
            try {
                if (isProjectQueueRow(head)) {
                    setTaskActivity(`Preparing ${shortPath(head.path)}`);
                    await dependencies.beginProject(ctx, head, currentHouse);
                }
                setTaskActivity(
                    `Working out what to ${head.op} from ${bulkSource(head)}`
                );
                children = await dependencies.expandBulk(ctx, head, currentHouse);
            } catch (error) {
                if (isTaskCancelled(error)) return "paused";
                const message = error instanceof Error ? error.message : String(error);
                setQueueRowStatus(head.key, "failed", message);
                if (tally !== undefined) {
                    tally.failed++;
                    tally.reason ??= message;
                }
                if (head.op === "import") return "idle";
                ChatLib.chat(`&c[htsw] ${queueOpLabel(head.op)} failed: ${message}`);
                continue;
            }
            const inserted = expandBulkQueueRow(head.key, children);
            if (inserted.length === 0 && !isProjectQueueRow(head)) {
                showToast(`${head.target.label}: nothing to do`, 0xffe5bc4b);
            }
            continue;
        }

        const session = queueSessionFromHead(head, currentHouse, options);
        if (session.length === 0) return "idle";
        if (head.op === "import" && !preparedImport) {
            setTaskActivity("Switching to creative mode");
            await dependencies.beforeFirstImport(ctx);
            preparedImport = true;
        }
        setTaskActivity(null);

        for (const row of session) setQueueRowStatus(row.key, "running");
        let result: QueueSessionResult;
        try {
            result =
                head.op === "import"
                    ? await dependencies.runImport(ctx, session, currentHouse)
                    : await dependencies.runExport(ctx, session, currentHouse);
        } catch (error) {
            if (isTaskCancelled(error)) {
                resetSessionRows(session);
                if (head.op !== "import") {
                    ChatLib.chat(
                        `&e[htsw] ${queueOpLabel(head.op)} cancelled by user &7· &f0&e ${queueOpVerb(head.op)}`
                    );
                }
                return "paused";
            }
            const message = error instanceof Error ? error.message : String(error);
            resetSessionRows(session);
            setQueueRowStatus(head.key, "failed", message);
            if (tally !== undefined) {
                tally.failed++;
                tally.reason ??= message;
            }
            if (head.op === "import") {
                ChatLib.chat(`&c[htsw] Import failed: ${String(error)}`);
                return "idle";
            }
            ChatLib.chat(`&c[htsw] ${queueOpLabel(head.op)} failed: ${message}`);
            continue;
        }

        if (result.cancelled === true) {
            if (tally !== undefined) {
                tally.completed += result.completedKeys.length;
                tally.failed += result.failed.length;
            }
            resetSessionRows(session);
            if (head.op !== "import") {
                ChatLib.chat(
                    `&e[htsw] ${queueOpLabel(head.op)} cancelled by user &7· &f${result.completedKeys.length}&e ${queueOpVerb(head.op)}`
                );
            }
            return "paused";
        }
        if (result.parseError === true) holdAutoRunUntilReparse();
        const failed = applySessionResult(
            session,
            result,
            (callback) => dependencies.scheduleDone(callback),
            tally
        );
        if (head.op === "import" && failed) {
            showToast("Queue stopped after import failure", 0xffe85c5c, 8000);
            return "idle";
        }
    }
}

export function startQueue(options: QueueStartOptions = {}): boolean {
    if (state === "running" || TaskManager.isBusy()) {
        rejectBridgeRun("import", "busy");
        return false;
    }
    const queue = getQueue();
    const eligible = queue.find(
        (row) =>
            (row.status === "queued" &&
                (!options.autoRun || !isRestoredQueueRow(row.key))) ||
            (!awaitingRemoval.has(row) && isUnfinishedProjectRow(row, queue))
    );
    if (!eligible) {
        rejectBridgeRun("import", "empty_queue");
        return false;
    }
    state = "running";
    pauseRequested = false;
    const tally: QueueRunTally = { completed: 0, failed: 0 };
    const approvedOverwritePaths = new Set<string>();
    const dependencies: QueueRunnerDependencies = {
        ...defaultDependencies,
        runExport: async (ctx, rows, currentHouse) =>
            (await confirmExportOverwrites(ctx, rows, approvedOverwritePaths))
                ? runQueuedExportSession(ctx, rows, currentHouse)
                : { completedKeys: [], failed: [], cancelled: true },
    };
    void runHousingSyncTask(
        "queue",
        (ctx) => drainQueue(ctx, dependencies, options, tally),
        { operation: eligible.op }
    )
        .then((next) => {
            state = next ?? "paused";
            printQueueRunEnd(state, tally);
        })
        .catch((error: unknown) => {
            state = "idle";
            emitBridgeEvent("htsw_queue", {
                scope: "queue",
                phase: "finished",
                state: "failed",
                reason: String(error),
                ...tally,
            });
            finishBridgeRun("failed", { reason: String(error), ...tally });
            ChatLib.chat(`&c[htsw] Queue failed: ${String(error)}`);
            showToast(`Queue failed: ${String(error)}`, 0xffe85c5c, 8000);
        })
        .finally(() => {
            pauseRequested = false;
            notifyQueueRunEnded();
        });
    return true;
}

export function printQueueRunEnd(runState: QueueRunState, tally: QueueRunTally): void {
    const queued = getQueue().filter((row) => row.status === "queued").length;
    const label = runState === "paused" ? "paused" : "finished";
    const colour = runState === "paused" ? "&e" : "&a";
    const status =
        runState === "paused" ? "paused" : tally.failed > 0 ? "failed" : "completed";
    emitBridgeEvent("htsw_queue", {
        scope: "queue",
        phase: "finished",
        state: status === "failed" ? "failed" : runState,
        ...tally,
        queued,
    });
    finishBridgeRun(status, { ...tally, queued });
    ChatLib.chat(
        `${colour}[htsw] Queue ${label} &7· &f${tally.completed}${colour} completed, &f${tally.failed}${colour} failed, &f${queued}&7 queued`
    );
}

function queueOpLabel(op: QueueOp): "Export" | "Read" {
    return op === "read" ? "Read" : "Export";
}

function queueOpVerb(op: QueueOp): "exported" | "read" {
    return op === "read" ? "read" : "exported";
}

export function resumeQueue(): boolean {
    if (state !== "paused") return false;
    state = "idle";
    return startQueue();
}

export function pauseQueue(): "requested" | "forced" | null {
    if (state !== "running") return null;
    pauseRequested = true;
    emitBridgeEvent("htsw_queue", { scope: "queue", phase: "pausing" });
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
    if (filter === "unread") return op === "read";
    return op === "export";
}

export function matchesBulkCacheState(
    filter: BulkFilter,
    state: "current" | "modified" | "unknown",
    trusted: boolean
): boolean {
    if (filter === "modified") return state !== "current";
    // An untrusted house cannot establish a reliable cache baseline, so its
    // `modified` state is not enough to claim the live and local sides differ.
    if (filter === "changed") return trusted && state === "modified";
    // Untrusted knowledge is no knowledge: reading re-establishes it.
    if (filter === "unread") return !trusted || state === "unknown";
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
        // Items have no house reader and export only from the held stack.
        if (row.op !== "import" && importable.type === "ITEM") return false;
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
            selected = selectedImportables(values, row, house).map((importable) => ({
                type: importable.type,
                identity: importableIdentity(importable),
                label: importable.type === "EVENT" ? importable.event : importable.name,
            }));
        } else if (row.target.filter === "changed" || row.target.filter === "unread") {
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
    runSession: typeof runExportSession = runExportSession,
    newExportTarget: () => string | null = getNewExportTarget
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
    try {
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
                    type === "ITEM" || (first.op === "export" && type === "NPC")
                        ? undefined
                        : batchRows.map((row) =>
                              row.target.kind === "importable" ? row.target.identity : ""
                          ),
                npcEntries:
                    first.op === "export" && type === "NPC"
                        ? batchRows.map((row) => ({
                              name: row.target.label,
                              pos: parseNpcPosIdentity(
                                  row.target.kind === "importable"
                                      ? row.target.identity
                                      : ""
                              ),
                          }))
                        : undefined,
                newExportTargetImportJson:
                    first.op === "export" ? (newExportTarget() ?? undefined) : undefined,
                queueRows: batchRows,
                onQueueRowFinished: (key: string, error?: string) => {
                    if (error === undefined) completedKeys.push(key);
                    else failed.push({ key, error });
                },
            }))
        );
    } catch (error) {
        if (!isTaskCancelled(error)) throw error;
        return { completedKeys, failed, cancelled: true };
    }
    const itemRows = batches.get("ITEM") ?? [];
    for (const itemRow of itemRows) {
        if (completedKeys.indexOf(itemRow.key) < 0) completedKeys.push(itemRow.key);
    }
    for (const failure of failed) {
        const row = rows.find((candidate) => candidate.key === failure.key);
        if (row?.target.kind !== "importable") continue;
        ChatLib.chat(
            `&c[htsw] ${queueOpLabel(first.op)} failed on ${row.target.type} ${row.target.identity}: ${failure.error}`
        );
    }
    const elapsed = formatElapsedSeconds(ctx.elapsedMs() / 1000);
    ChatLib.chat(
        `&a[htsw] ${queueOpLabel(first.op)} complete in ${elapsed} &7· &f${completedKeys.length}&a ${queueOpVerb(first.op)}, &f${failed.length}&c failed`
    );
    return { completedKeys, failed };
}

// An export replaces local entries with the house versions, so a session that
// would overwrite declared entries asks first. "Export anyway" covers that file
// for the rest of the run, so a whole-house export asks once, not once per type.
async function confirmExportOverwrites(
    ctx: TaskContext,
    rows: readonly QueueRow[],
    approvedPaths: Set<string>
): Promise<boolean> {
    const path = rows[0].path;
    if (rows[0].op !== "export" || approvedPaths.has(path)) return true;
    const declared = new Set(
        ((await parseImportJsonCurrent(path)).parsed?.value ?? []).map(
            (importable) => `${importable.type}:${importableIdentity(importable)}`
        )
    );
    const names: string[] = [];
    for (const row of rows) {
        if (row.target.kind !== "importable") continue;
        if (declared.has(`${row.target.type}:${row.target.identity}`)) {
            names.push(`${row.target.type} ${row.target.label}`);
        }
    }
    if (names.length === 0) return true;
    const entries = names.length === 1 ? "entry" : "entries";
    const lines = names.slice(0, 5).map((name) => `• ${name}`);
    if (names.length > 5) lines.push(`…and ${names.length - 5} more`);
    lines.push("Export replaces the local versions with the house versions.");
    const proceed = await openAnswerableConflictPrompt(ctx, {
        chatMessage:
            `[htsw] Export would overwrite ${names.length} local ${entries} — awaiting confirmation\n` +
            names.map((name) => `[htsw] Overwrite: ${name}`).join("\n"),
        chatConfirmAction: "export anyway",
        chatRefuseAction: "cancel the export",
        title: `Overwrite existing ${entries} (${names.length})?`,
        lines,
        confirmLabel: "Export anyway",
        danger: true,
    });
    if (proceed) approvedPaths.add(path);
    return proceed;
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
    beginProject: beginProjectRun,
    finishProject: finishProjectRun,
    runImport: runImportQueueSession,
    runExport: runQueuedExportSession,
    scheduleDone(callback) {
        setTimeout(callback, 1500);
    },
};
