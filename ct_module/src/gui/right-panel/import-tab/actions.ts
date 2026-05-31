/// <reference types="../../../../CTAutocomplete" />

import {
    createImportRows,
    createImportProgress,
    clearLastFinishedProgress,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    clearImportableChecks,
    getAutoTrackSources,
    isAnyAutoTrackEnabled,
    isCurrentHouseTrusted,
    getImportProgress,
    isImportableChecked,
    refreshKnowledgeRowFromDisk,
    setActiveImportPath,
    setHousingUuid,
    setImportProgress,
    toggleImportableChecked,
} from "../../state";
import { scheduleKnowledgeBuild } from "../../state/knowledgeBuild";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueItem,
    type QueueItem,
} from "../../state/queue";
import { forEachCachedParse, getParseAt, parseImportJsonAt } from "../../state/parses";
import { printDiagnostics } from "../../../tui/diagnostics";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
} from "../../../importables/importSession";
import { exportImportable } from "../../../importables/exports";
import { exportAllFunctions } from "../../../importables/functions/exportAll";
import {
    captureFromHousing,
    type CaptureType,
} from "../../../exporter/captureFromHousing";
import { importableIdentity } from "../../../importCache/paths";
import { trustPlanKey } from "../../../importCache/trust";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { TaskManager, isTaskCancelled } from "../../../tasks/manager";
import type { Action, Importable } from "htsw/types";
import type { ParseResult } from "htsw";
import { closeAllPopovers } from "../../lib/popovers";
import { statusForImportable } from "../../knowledge-status";
import { htslFilenameForFunctionExport } from "../../../exporter/paths";
import { importableSourcePath } from "../../state/importablePaths";
import type {
    ActionDiffOperationPayload,
    ImportEventHandler,
    ImportEvent,
} from "../../../importer/importEvents";
import { importProgressKey } from "../../../importer/progress/keys";
import { initialReducerState, reduce } from "../../../importer/progress/reducer";
import { invalidateKnowledgeOverlayForImportable } from "../../state/knowledgeOverlay";
import { showToast } from "../../toast";
import { isImportRunning, setImportRunning } from "../../../importer/runtimeState";
import { gmcOnImportStart, playImportSuccessSound } from "../../../importer/sideEffects";
import { resetStepGate } from "../../../importer/stepGate";
import { startPacketOrderProbe, stopPacketOrderProbe } from "../../../importer/diagnostics/packetOrderProbe";
import { resetEventContainers } from "../../../tasks/specifics/waitFor";
import { flushMenuWaitTickSummary } from "../../../importer/gui/menuWait";
import {
    applyComplete,
    clearLiveOverlay,
    finalizeFromSource,
    markHeadApplied,
    markLiveCompleted,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    previewLineIdForPath,
    primeWithCache,
    resetPreview,
    setLiveCurrent,
    setLiveState,
    setLiveSummary,
    setObservedTopLevel,
    setPlannedOp,
} from "../../state/importPreviewState";
import { setFocusLineId } from "../../state/codeViewState";
import { ACTION_MAPPINGS } from "../../../importer/fields/actionMappings";

export const CAPTURE_TYPES: CaptureType[] = ["FUNCTION", "MENU"];

let importSessionId = 0;

function formatElapsedSeconds(secs: number): string {
    const total = Math.max(0, Math.round(secs));
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `${m}m` : `${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `${h}h` : `${h}h${mm}m`;
}

function refreshKnowledgeRows(): void {
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const all: Importable[] = [];
    const seen = new Set<string>();
    const importJsonPath = getImportJsonPath();
    const main = getParseAt(importJsonPath);
    if (main !== null && main.parsed !== null) {
        for (const imp of main.parsed.value) {
            const id = `${imp.type}:${importableIdentity(imp)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            all.push(imp);
        }
    }

    // Tick-batched rebuild (see knowledgeBuild): synchronous froze the client
    // for ~1s on large files, and the old setTimeout batches stalled for minutes
    // under load. autoTrackRefresh reads cached parses, not the rows, so it can
    // run as soon as the build is scheduled.
    scheduleKnowledgeBuild(uuid, all);
    autoTrackRefresh();
}

export function autoTrackRefresh(): void {
    if (!isAnyAutoTrackEnabled()) return;
    const uuid = getHousingUuid();
    if (uuid === null) return;
    const tracked = getAutoTrackSources();
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        if (!tracked.has(entry.canonicalPath)) return;
        queueModifiedFromParse(entry.canonicalPath, entry.parsed.value);
    });
}

export function queueModifiedFromParse(
    sourcePath: string,
    importables: readonly Importable[]
): void {
    for (const imp of importables) {
        const status = statusForImportable(imp);
        if (status === "modified" || status === "unknown") {
            const item = makeImportableQueueItem(imp, sourcePath);
            addToQueue(item);
            const key = trustPlanKey(imp.type, importableIdentity(imp));
            if (!isImportableChecked(key)) toggleImportableChecked(key);
        }
    }
}

function displayNameForActionType(type: Action["type"] | null): string {
    return type === null ? "Unknown Action" : ACTION_MAPPINGS[type].displayName;
}

function operationVerb(op: ActionDiffOperationPayload["op"]): string {
    if (op === "add") return "Add";
    if (op === "edit") return "Edit";
    if (op === "move") return "Move";
    return "Delete";
}

function operationLabel(event: ActionDiffOperationPayload): string {
    const name = displayNameForActionType(event.actionType);
    if (event.op === "move") {
        return `${operationVerb(event.op)} ${name} -> #${event.toIndex + 1}`;
    }
    return `${operationVerb(event.op)} ${name}`;
}

function operationDetail(event: ActionDiffOperationPayload): string {
    if (event.op === "add") return "add source action";
    if (event.op === "move") return `#${event.fromIndex + 1} -> #${event.toIndex + 1}`;
    if (event.op === "edit") {
        return event.fieldsChanged.length === 0 ? "fields changed" : event.fieldsChanged.join(", ");
    }
    return "delete source action";
}

function readingLabel(actionType: Action["type"] | null): string {
    return `Reading ${displayNameForActionType(actionType)}`;
}

type SessionEventHandler = ImportEventHandler & {
    counts(): { imported: number; skipped: number; failed: number };
};

function createImportEventHandler(args: {
    parsed: ParseResult<Importable[]>;
    sessionSourcePath: string;
    trustMode: boolean;
    housingUuid: string;
}): SessionEventHandler {
    let state = initialReducerState();
    let activeViewPath: string | null = null;

    // Precompute key → importable so importableStarted handler is O(1).
    const importablesByKey = new Map<string, Importable>();
    for (const imp of args.parsed.value) {
        importablesByKey.set(
            importProgressKey(imp.type, importableIdentity(imp), args.sessionSourcePath),
            imp
        );
    }

    const sync = (): void => {
        setImportProgress(state.progress);
        setActiveImportPath(activeViewPath);
    };

    // Mapped type: one handler per event kind, parameter narrowed to the
    // specific event shape. TS enforces exhaustiveness — a new kind on the
    // union surfaces here as a typecheck error.
    type Handlers = {
        [E in ImportEvent as E["kind"]]: (event: E) => void;
    };
    const handlers: Handlers = {
        sessionStarted: () => {},
        importableStarted: (e) => {
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewPath =
                imp === null ? null : (importableSourcePath(imp, args.parsed) ?? null);
            if (activeViewPath !== null) {
                clearLiveOverlay(activeViewPath);
                resetPreview(activeViewPath);
                primeWithCache(activeViewPath, e.cached, { shellOnly: !args.trustMode });
            }
        },
        importableFinished: (e) => {
            const imp = importablesByKey.get(e.key);
            if (imp !== undefined) {
                // Targeted single-row disk re-read: turns this importable's dot
                // green the instant it finishes. The batched full refresh below
                // re-reads all 193 rows through chained setTimeouts and can lag
                // minutes; this one is synchronous and O(1).
                refreshKnowledgeRowFromDisk(args.housingUuid, imp);
                if (e.status === "imported") {
                    invalidateKnowledgeOverlayForImportable(imp, args.parsed);
                }
            }
        },
        importableReactivated: (e) => {
            // Pass-2 (apply) re-activates an importable previously parked
            // after pass-1 pre-read. Re-bind the preview to this row's
            // source file so the apply-phase diff overlay lands in the
            // right pane.
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewPath =
                imp === null ? null : (importableSourcePath(imp, args.parsed) ?? null);
        },
        sessionFinished: () => {
            activeViewPath = null;
        },
        progress: () => {},
        setupStep: () => {},
        readStarted: () => {},
        nestedReadStarted: (e) => {
            if (activeViewPath === null) return;
            const label = readingLabel(e.actionType);
            setLiveCurrent(activeViewPath, e.path, label);
            setFocusLineId(activeViewPath, previewLineIdForPath(activeViewPath, e.path));
        },
        diffPlanned: (e) => {
            if (activeViewPath === null) return;
            setLiveSummary(activeViewPath, e.summary);
            for (const op of e.operations) {
                if (op.op === "delete") {
                    if (op.observed !== null) {
                        markPlannedDelete(activeViewPath, op.path);
                    }
                    continue;
                }
                setPlannedOp(activeViewPath, op.path, op.op, operationLabel(op), operationDetail(op));
                if (op.op === "add") {
                    markPlannedAdd(activeViewPath, op.path, op.desired, op.toIndex);
                } else if (op.op === "edit") {
                    markPlannedEdit(activeViewPath, op.path, op.observed, op.desired);
                } else if (op.op === "move") {
                    markPlannedMove(activeViewPath, op.path, op.fromIndex, op.toIndex);
                }
            }
            for (const p of e.matches) setLiveState(activeViewPath, p, "match");
        },
        operationStarted: (e) => {
            if (activeViewPath === null) return;
            setLiveCurrent(activeViewPath, e.path, operationLabel(e));
            setPlannedOp(activeViewPath, e.path, e.op, operationLabel(e), "");
            setFocusLineId(activeViewPath, previewLineIdForPath(activeViewPath, e.path));
        },
        operationCompleted: (e) => {
            if (activeViewPath === null) return;
            setLiveState(activeViewPath, e.path, e.finalState);
            markLiveCompleted(activeViewPath, e.path);
            setLiveCurrent(activeViewPath, null, "");
            applyComplete(activeViewPath, e.path, e.finalState, e.op);
        },
        listSyncCompleted: () => {
            if (activeViewPath === null) return;
            setLiveCurrent(activeViewPath, null, "");
            setFocusLineId(activeViewPath, null);
        },
        observedSnapshot: (e) => {
            if (activeViewPath !== null) setObservedTopLevel(activeViewPath, e.actions);
        },
        blockActionHeaderApplied: (e) => {
            if (activeViewPath !== null) markHeadApplied(activeViewPath, e.path);
        },
        finalizeSource: (e) => {
            if (activeViewPath !== null) finalizeFromSource(activeViewPath, e.actions);
        },
    };

    return {
        emit: (event) => {
            state = reduce(state, event);
            (handlers[event.kind] as (e: typeof event) => void)(event);
            sync();
        },
        counts: () => {
            let imported = 0;
            let skipped = 0;
            let failed = 0;
            for (const row of state.progress.rows) {
                if (row.status === "imported") imported++;
                else if (row.status === "skipped") skipped++;
                else if (row.status === "failed") failed++;
            }
            return { imported, skipped, failed };
        },
    };
}

// ── Queue → per-import.json batches ──────────────────────────────────────

type ImportBatch = {
    sourcePath: string; // canonical absolute path of the import.json
    parsed: ParseResult<Importable[]>;
    importables: Importable[]; // ordered for the importer
};

/**
 * Group queued items by their declaring import.json so we can hand each
 * batch to a single `importSelectedImportables` call (which assumes one
 * shared `sourcePath` across all importables it processes). `importJson`
 * items expand to every importable in their parse; `importable` items
 * resolve to the matching object inside the parse.
 *
 * Returns null when nothing in the queue could be resolved — the caller
 * uses that to short-circuit with a friendly chat message.
 */
function buildBatches(explicit?: readonly QueueItem[]): ImportBatch[] | null {
    const queue = explicit ?? getQueue();
    if (queue.length === 0) return null;
    type Group = {
        parsed: ParseResult<Importable[]>;
        /** Identity keys in queue insertion order. */
        orderedIds: string[];
        seen: Set<string>;
        addAll: boolean;
    };
    const groups = new Map<string, Group>();
    for (const item of queue) {
        const cached = parseImportJsonAt(item.sourcePath);
        if (cached.parsed === null) {
            ChatLib.chat(`&c[htsw] Skipping ${item.sourcePath}: ${cached.error ?? "parse failed"}`);
            continue;
        }
        let group = groups.get(item.sourcePath);
        if (group === undefined) {
            group = { parsed: cached.parsed, orderedIds: [], seen: new Set<string>(), addAll: false };
            groups.set(item.sourcePath, group);
        }
        if (item.kind === "importJson") {
            group.addAll = true;
        } else {
            const k = `${item.type}:${item.identity}`;
            if (!group.seen.has(k)) {
                group.seen.add(k);
                group.orderedIds.push(k);
            }
        }
    }
    const batches: ImportBatch[] = [];
    for (const [sourcePath, g] of groups.entries()) {
        const byKey = new Map<string, Importable>();
        for (const imp of g.parsed.value) {
            byKey.set(`${imp.type}:${importableIdentity(imp)}`, imp);
        }
        const wanted: Importable[] = [];
        if (g.addAll) {
            for (const imp of g.parsed.value) wanted.push(imp);
        } else {
            for (const k of g.orderedIds) {
                const imp = byKey.get(k);
                if (imp !== undefined) wanted.push(imp);
            }
        }
        if (wanted.length === 0) continue;
        const ordered = orderImportablesForImportSession(g.parsed.value, wanted);
        batches.push({ sourcePath, parsed: g.parsed, importables: ordered });
    }
    return batches.length === 0 ? null : batches;
}

/**
 * Build queue items for every importable whose `trustPlanKey` is in
 * `checked`. Walks every cached parse so importables across multiple
 * loaded import.jsons all get picked up.
 */
export function queueItemsForCheckedKeys(checked: Set<string>): QueueItem[] {
    if (checked.size === 0) return [];
    const out: QueueItem[] = [];
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        for (const imp of entry.parsed.value) {
            const key = trustPlanKey(imp.type, importableIdentity(imp));
            if (!checked.has(key)) continue;
            out.push({
                kind: "importable",
                sourcePath: entry.canonicalPath,
                identity: importableIdentity(imp),
                type: imp.type,
                label: imp.type === "EVENT" ? imp.event : imp.name,
            });
        }
    });
    return out;
}

export function startImport(explicit?: readonly QueueItem[]): void {
    // Re-entry guard. TaskManager.run does not serialise tasks, so without this
    // a second click (or a click during the brief end-of-run window where the
    // panel already reads "done" but the task hasn't fully unwound) would launch
    // a SECOND concurrent import. Two tasks driving the same Housing menus
    // deadlock — the classic "menu opened once then stopped".
    if (isImportRunning() || TaskManager.hasRunningTasks()) {
        ChatLib.chat("&c[htsw] An import (or another task) is already running — wait for it to finish or cancel it first.");
        return;
    }
    const batches = buildBatches(explicit);
    if (batches === null) {
        const msg =
            explicit !== undefined
                ? "Nothing matched the selection — try checking importables in the Importables tab first."
                : "Queue is empty — right-click something and Add to queue.";
        ChatLib.chat(`&c[htsw] ${msg}`);
        return;
    }
    const failed = batches.filter((b) => b.parsed.gcx.isFailed());
    if (failed.length > 0) {
        ChatLib.chat(
            `&c[htsw] Import aborted — ${failed.length} file${failed.length === 1 ? "" : "s"} ` +
                `with errors. Fix the diagnostics below and retry.`
        );
        for (const batch of failed) {
            ChatLib.chat(`&7  in ${batch.sourcePath}:`);
            const errors = batch.parsed.gcx.diagnostics.filter(
                (d) => d.level === "error" || d.level === "bug"
            );
            printDiagnostics(batch.parsed.gcx.sourceMap, errors);
        }
        return;
    }
    const trustMode = isCurrentHouseTrusted();

    // Concatenate every batch's ordered importables for the run-row
    // tracking; the per-row UI only needs the flat list, not the
    // per-batch grouping.
    let rows = createImportRows(batches[0].importables, batches[0].sourcePath);
    for (let i = 1; i < batches.length; i++) {
        rows = rows.concat(createImportRows(batches[i].importables, batches[i].sourcePath));
    }
    setImportProgress(createImportProgress({
        totalUnits: 1,
        rows,
    }));

    setImportRunning(true);
    const sessionId = ++importSessionId;
    const startedAt = Date.now();
    resetStepGate();
    gmcOnImportStart();
    startPacketOrderProbe();

    TaskManager.run(async (ctx) => {
        let importSucceeded = false;
        let cancelled = false;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalFailed = 0;
        try {
            // Purge any waiters left over from a prior import. Nothing legit is
            // waiting at an import boundary, so survivors are leaks; a non-zero
            // count is a canary that one slipped through the cleanup paths.
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior import.`);
            }
            const cached = getHousingUuid();
            let housingUuid = cached;
            if (housingUuid === null) {
                housingUuid = await getCurrentHousingUuid(ctx);
                setHousingUuid(housingUuid);
            }
            for (const batch of batches) {
                const events = createImportEventHandler({
                    parsed: batch.parsed,
                    sessionSourcePath: batch.sourcePath,
                    trustMode,
                    housingUuid,
                });
                await importSelectedImportables(ctx, {
                    importables: batch.importables,
                    trustMode,
                    housingUuid,
                    sourcePath: batch.sourcePath,
                    parsed: batch.parsed,
                    events,
                });
                const c = events.counts();
                totalImported += c.imported;
                totalSkipped += c.skipped;
                totalFailed += c.failed;
            }
            importSucceeded = totalFailed === 0;
        } catch (err) {
            if (isTaskCancelled(err)) {
                cancelled = true;
            } else {
                throw err;
            }
        } finally {
            stopPacketOrderProbe();
            flushMenuWaitTickSummary();
            setActiveImportPath(null);
            refreshKnowledgeRows();
            setImportRunning(false);
            const elapsed = formatElapsedSeconds((Date.now() - startedAt) / 1000);
            if (cancelled) {
                showToast(
                    `Import cancelled after ${elapsed} · ${totalImported} imported`,
                    0xffe5bc4b
                );
            } else if (importSucceeded) {
                playImportSuccessSound();
                showToast(
                    `Import complete in ${elapsed} · ${totalImported} imported, ${totalSkipped} skipped`,
                    0xff5cb85c
                );
                ChatLib.chat(
                    `&a[htsw] Import complete in ${elapsed} &7· &f${totalImported}&a imported, &f${totalSkipped}&7 skipped`
                );
            } else {
                // Surface the failure reason (read before clearing progress
                // below) — a failure halts the whole run, so the *why* must be
                // visible, not just "N failed".
                const failure = getImportProgress()?.failure;
                showToast(
                    failure
                        ? `Import failed: ${failure.message}`
                        : `Import finished in ${elapsed} with ${totalFailed} failed`,
                    0xffe85c5c,
                    8000
                );
            }
            setImportProgress(null);
            // Only auto-clear the queue after a fully successful queue run.
            // A cancelled or partially-failed import keeps the queue intact
            // so the user can retry without re-adding everything.
            if (explicit === undefined && importSucceeded) {
                setTimeout(() => {
                    if (importSessionId !== sessionId) return;
                    clearQueue();
                    clearImportableChecks();
                    clearLastFinishedProgress();
                }, 1500);
            } else {
                setTimeout(() => {
                    if (importSessionId !== sessionId) return;
                    clearLastFinishedProgress();
                }, 1500);
            }
        }
    }).catch((err: unknown) => {
        setImportRunning(false);
        ChatLib.chat(`&c[htsw] Import failed: ${err}`);
    });
}

// ── Batch export flow ─────────────────────────────────────────────────

export function startExportAllFunctions(): void {
    closeAllPopovers();
    const importJsonPath = getExportImportJsonPath();
    if (importJsonPath.trim() === "") {
        ChatLib.chat("&c[htsw] No import.json loaded — load one first");
        return;
    }
    const dir = importJsonDir(importJsonPath);
    TaskManager.run(async (ctx) => {
        await exportAllFunctions(ctx, { importJsonPath, rootDir: dir });
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Export all functions failed: ${err}`);
    });
}

export function stopAllTasks(): void {
    TaskManager.cancelAll();
    ChatLib.chat("&c[htsw] cancelling running task...");
}

// ── Capture flow ──────────────────────────────────────────────────────

function importJsonDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

export function startCaptureExport(type: CaptureType): void {
    closeAllPopovers();
    TaskManager.run(async (ctx) => {
        const result = await captureFromHousing(ctx, type);
        if (result.kind === "cancelled") {
            ctx.displayMessage("&7[htsw] Export cancelled");
            return;
        }
        const importJsonPath = getExportImportJsonPath();
        if (importJsonPath.trim() === "") {
            ctx.displayMessage("&c[htsw] No import.json loaded — load one first");
            return;
        }
        const dir = importJsonDir(importJsonPath);
        if (result.type === "FUNCTION") {
            const filename = htslFilenameForFunctionExport(importJsonPath, result.name);
            await exportImportable(ctx, {
                type: "FUNCTION",
                name: result.name,
                importJsonPath,
                htslPath: `${dir}/${filename}`,
                htslReference: filename,
                rootDir: dir,
            });
        } else {
            await exportImportable(ctx, {
                type: "MENU",
                name: result.name,
                importJsonPath,
                rootDir: dir,
            });
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Export failed: ${err}`);
    });
}
