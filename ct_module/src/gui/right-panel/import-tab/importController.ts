/// <reference types="../../../../CTAutocomplete" />

import {
    getExportImportJsonPath,
    getHousingUuid,
    clearImportableChecks,
    isCurrentHouseTrusted,
    isImportSoundsMuted,
    setHousingUuid,
} from "../../state";
import {
    createTaskRows,
    createTaskProgress,
    clearLastFinishedProgress,
    getTaskProgress,
    setActiveTaskPath,
    setTaskProgress,
} from "./taskProgress";
import {
    addToQueue,
    beginQueueSession,
    endQueueSession,
    getQueue,
    isImportQueueItem,
    queueItemKey,
    removeFromQueueKey,
    type ImportQueueItem,
} from "./queue";
import {
    getParseAt,
    markParseStale,
    parseImportJsonBlocking,
} from "../../parsing/parses";
import { printDiagnostics } from "../../../tui/diagnostics";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
} from "../../../importables/importSession";
import type { ExportResult } from "../../../importables/exports";
import { importableIdentity } from "../../../importables/identity";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { TaskManager, isTaskCancelled } from "../../../tasks/manager";
import type TaskContext from "../../../tasks/context";
import type { Importable, ImportableItem } from "htsw/types";
import type { Diagnostic, ImportablesParseResult } from "htsw";
import { closeAllPopovers } from "../../lib/popovers";
import { shortPath } from "../../lib/pathDisplay";
import { importableSourcePath } from "../../parsing/importablePaths";
import { attributeDiagnostics } from "../../cache-status/diagnosticCounts";
import type {
    SyncEventHandler,
    SyncEvent,
} from "../../../housingSync/syncEvents";
import { queueRowKey } from "../../../housingSync/progress/queueRowKey";
import type { ExportProgressSink } from "../../../housingSync/progress/types";
import { createExportProgressSink } from "./exportProgress";
import { initialReducerState, reduce } from "../../../housingSync/progress/reducer";
import { traceSyncEvent } from "../../../housingSync/trace/taskTrace";
import { traceProgressEvent } from "../../../housingSync/trace/progressTrace";
import { invalidateSourceDiffForImportable } from "../../code-view/sourceDiff";
import { showToast } from "../../toast";
import { isTaskRunning, setTaskRunning } from "../../../tasks/runningState";
import { gmcOnImportStart, playImportSuccessSound, waitForCreativeMode } from "../../../housingSync/sideEffects";
import { resetStepGate } from "../../../housingSync/stepGate";
import { resetEventContainers } from "../../../tasks/specifics/waitFor";
import {
    applyComplete,
    finalizeFromSource,
    markHeadApplied,
    markMatch,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    previewLineIdForPath,
    primeWithCache,
    resetPreview,
    setCurrent,
    setLiveSummary,
    setObservedTopLevel,
} from "./livePreview";
import { setFocusLineId } from "./focusedLine";
import { autoTrackRefresh } from "../../autoTrack";
import {
    cancelActiveExport,
    clearActiveExportContext,
    setActiveExportContext,
} from "../../../exporter/activeExport";


/**
 * The TaskContext of the in-flight import, or null when none is running.
 * Captured so Cancel scopes to the import alone — `TaskManager.cancelAll()`
 * would also abort unrelated background tasks (e.g. the housing-UUID
 * auto-fetch in overlay.ts).
 */
let activeImportCtx: TaskContext | null = null;

/** Cancel the running import (if any). Leaves other tasks untouched. */
export function cancelActiveImport(): void {
    if (activeImportCtx !== null) {
        activeImportCtx.cancel();
        return;
    }
    cancelActiveExport();
}

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

const BODY_LIST_PROPS: Record<string, true> = {
    ifActions: true,
    elseActions: true,
    actions: true,
};

// True when an edit touches the action's head line. A CONDITIONAL/RANDOM whose
// only changed fields are child action lists (ifActions/elseActions/actions)
// leaves its head — `if (conditions) {` / `random {` — unchanged; those body
// ops mark their own lines, so flagging the head would falsely show the
// conditions as changed. An empty list (note-only edit) keeps the head marked.
function editAffectsHeadLine(fieldsChanged: readonly string[]): boolean {
    if (fieldsChanged.length === 0) return true;
    for (let i = 0; i < fieldsChanged.length; i++) {
        if (!BODY_LIST_PROPS[fieldsChanged[i]]) return true;
    }
    return false;
}

type SessionEventHandler = SyncEventHandler & {
    counts(): { imported: number; skipped: number; failed: number };
};

function createSyncEventHandler(args: {
    parsed: ImportablesParseResult;
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
            queueRowKey(imp.type, importableIdentity(imp), args.sessionSourcePath),
            imp
        );
    }

    const sync = (): void => {
        setTaskProgress(state.progress);
        setActiveTaskPath(activeViewPath);
    };

    // Mapped type: one handler per event kind, parameter narrowed to the
    // specific event shape. TS enforces exhaustiveness — a new kind on the
    // union surfaces here as a typecheck error.
    type Handlers = {
        [E in SyncEvent as E["kind"]]: (event: E) => void;
    };
    const handlers: Handlers = {
        sessionStarted: () => {},
        importableStarted: (e) => {
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewPath =
                imp === null ? null : (importableSourcePath(imp, args.parsed) ?? null);
            if (activeViewPath !== null) {
                resetPreview(activeViewPath);
                primeWithCache(activeViewPath, e.cached, { shellOnly: !args.trustMode });
            }
        },
        importableFinished: (e) => {
            const imp = importablesByKey.get(e.key);
            if (imp !== undefined && e.status === "imported") {
                invalidateSourceDiffForImportable(imp, args.parsed);
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
        childListReadStarted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, e.path);
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
                if (op.op === "edit" && !editAffectsHeadLine(op.fieldsChanged)) {
                    markMatch(activeViewPath, op.path);
                    continue;
                }
                if (op.op === "add") {
                    markPlannedAdd(activeViewPath, op.path, op.desired, op.toIndex);
                } else if (op.op === "edit") {
                    markPlannedEdit(activeViewPath, op.path, op.observed, op.desired);
                } else if (op.op === "move") {
                    markPlannedMove(activeViewPath, op.path, op.fromIndex, op.toIndex);
                }
            }
            for (const p of e.matches) markMatch(activeViewPath, p);
        },
        operationStarted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, e.path);
            if (e.op === "edit" && !editAffectsHeadLine(e.fieldsChanged)) {
                markMatch(activeViewPath, e.path);
            }
            setFocusLineId(activeViewPath, previewLineIdForPath(activeViewPath, e.path));
        },
        operationCompleted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, null);
            applyComplete(activeViewPath, e.path, e.finalState, e.op);
        },
        listSyncCompleted: () => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, null);
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
            const before = state.progress;
            state = reduce(state, event);
            traceProgressEvent(event, before, state.progress);
            traceSyncEvent(event);
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
    parsed: ImportablesParseResult;
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
function buildBatches(explicit?: readonly ImportQueueItem[]): ImportBatch[] | null {
    const queue = explicit ?? getQueue().filter(isImportQueueItem);
    if (queue.length === 0) return null;
    type Group = {
        parsed: ImportablesParseResult;
        /** Identity keys in queue insertion order. */
        orderedIds: string[];
        seen: Set<string>;
        addAll: boolean;
    };
    const groups = new Map<string, Group>();
    for (const item of queue) {
        const cached = parseImportJsonBlocking(item.sourcePath);
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
 * The parse errors worth blocking the import on: every error owned by an
 * imported importable, plus every unattributed error (span-less, or a file
 * we can't tie to any importable). Errors owned only by a DIFFERENT
 * importable not being imported this run are dropped, so importing one
 * importable isn't blocked by an unrelated sibling's error in the same
 * import.json. Shares one attribution pass with the per-importable badges.
 *
 * Safe by construction: an error is excluded only when it's attributed to
 * other importables and none of ours — so a real error in what you're
 * importing can never be hidden.
 */
function relevantParseErrors(batch: ImportBatch): Diagnostic[] {
    const attr = attributeDiagnostics(batch.parsed);
    const relevant = new Set<Diagnostic>();
    for (const imp of batch.importables) {
        const ds = attr.byImportable.get(imp);
        if (ds !== undefined) for (const d of ds) relevant.add(d);
    }
    for (const d of attr.unattributed) relevant.add(d);
    return batch.parsed.gcx.diagnostics.filter(
        (d) => (d.level === "error" || d.level === "bug") && relevant.has(d)
    );
}

export function startImport(explicit?: readonly ImportQueueItem[]): void {
    // Re-entry guard. TaskManager.run does not serialise tasks, so without this
    // a second click (or a click during the brief end-of-run window where the
    // panel already reads "done" but the task hasn't fully unwound) would launch
    // a SECOND concurrent import. Two tasks driving the same Housing menus
    // deadlock — the classic "menu opened once then stopped".
    if (isTaskRunning() || TaskManager.hasRunningTasks()) {
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
    const failed = batches
        .map((batch) => ({ batch, errors: relevantParseErrors(batch) }))
        .filter((f) => f.errors.length > 0);
    if (failed.length > 0) {
        ChatLib.chat(
            `&c[htsw] Import aborted — ${failed.length} file${failed.length === 1 ? "" : "s"} ` +
                `with errors. Fix the diagnostics below and retry.`
        );
        for (const { batch, errors } of failed) {
            ChatLib.chat(`&7  in ${batch.sourcePath}:`);
            printDiagnostics(batch.parsed.gcx.sourceMap, errors);
        }
        return;
    }
    const trustMode = isCurrentHouseTrusted();

    // Concatenate every batch's ordered importables for the run-row
    // tracking; the per-row UI only needs the flat list, not the
    // per-batch grouping.
    let rows = createTaskRows(batches[0].importables, batches[0].sourcePath);
    for (let i = 1; i < batches.length; i++) {
        rows = rows.concat(createTaskRows(batches[i].importables, batches[i].sourcePath));
    }
    setTaskProgress(createTaskProgress({
        totalUnits: 1,
        rows,
    }));

    // A command import (`explicit`) gets reflected into the visible queue so
    // it shows up + animates like a GUI run; otherwise we'd run an invisible
    // import with an empty queue. Add the explicit items first, THEN snapshot
    // the session keys to exactly those — pre-existing queue items get
    // session-marked by beginQueueSession but must NOT be cleaned up here,
    // since the explicit batch only ran what `explicit` named.
    if (explicit !== undefined) {
        for (const item of explicit) addToQueue(item);
    }
    beginQueueSession();

    setTaskRunning(true);
    // Snapshot this session's queue keys so the post-run cleanup can drop
    // exactly these items even if a newer import supersedes the session.
    const sessionItemKeys: string[] = (explicit ?? getQueue().filter(isImportQueueItem)).map(queueItemKey);
    const startedAt = Date.now();
    resetStepGate();
    gmcOnImportStart();

    TaskManager.run(async (ctx) => {
        activeImportCtx = ctx;
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
            if (!(await waitForCreativeMode(ctx))) {
                ChatLib.chat("&e[htsw] Still not in creative after /gmc — item spawns may fail. Check your gamemode permissions on this plot.");
            }
            for (const batch of batches) {
                const events = createSyncEventHandler({
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
                // A failed importable can leave the Housing menu mid-edit, so
                // the menu state for the next batch is unknown. Abort the run
                // rather than drive unrelated files from an uncertain menu.
                if (c.failed > 0) break;
            }
            importSucceeded = totalFailed === 0;
        } catch (err) {
            if (isTaskCancelled(err)) {
                cancelled = true;
            } else {
                throw err;
            }
        } finally {
            activeImportCtx = null;
            setActiveTaskPath(null);
            autoTrackRefresh();
            setTaskRunning(false);
            const elapsed = formatElapsedSeconds((Date.now() - startedAt) / 1000);
            if (cancelled) {
                showToast(
                    `Import cancelled after ${elapsed} · ${totalImported} imported`,
                    0xffe5bc4b
                );
            } else if (importSucceeded) {
                // Gate our own cue here: the overlay soundPlay interceptor only
                // suppresses sounds while task progress is live, and this fires
                // at completion — so the toggle must be checked directly.
                if (!isImportSoundsMuted()) playImportSuccessSound();
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
                const failure = getTaskProgress()?.failure;
                showToast(
                    failure
                        ? `Import failed: ${failure.message}`
                        : `Import finished in ${elapsed} with ${totalFailed} failed`,
                    0xffe85c5c,
                    8000
                );
            }
            setTaskProgress(null);
            // End the queue session after the 1.5s done-state window. A fully
            // successful queue run removes the session items (pending adds
            // stay); a cancel/failure keeps them for retry and just drops the
            // session marking so they merge back into the normal queue.
            const removeSessionItems = importSucceeded;
            setTimeout(() => {
                // Drop this session's successful items even if a newer import
                // has since started — otherwise a superseded cleanup leaves
                // them (and their "done" bar) stuck in the queue forever.
                if (removeSessionItems) {
                    for (let i = 0; i < sessionItemKeys.length; i++) {
                        removeFromQueueKey(sessionItemKeys[i]);
                    }
                }
                // The global session marking + last-finished progress belong to
                // whichever import is live. Only clear them when nothing is
                // running, so a stranded session can't leave the divider stuck.
                if (!isTaskRunning()) {
                    endQueueSession(false);
                    if (removeSessionItems) clearImportableChecks();
                    clearLastFinishedProgress();
                }
            }, 1500);
        }
    }).catch((err: unknown) => {
        setTaskRunning(false);
        ChatLib.chat(`&c[htsw] Import failed: ${err}`);
    });
}

// ── Batch export flow ─────────────────────────────────────────────────

export type ExportSpec = {
    type: Importable["type"];
    /** Singular lowercase noun used in user-facing messages, e.g. "function". */
    label: string;
    exportAll: (
        ctx: TaskContext,
        opts: {
            importJsonPath: string;
            rootDir: string;
            projectItems?: readonly ImportableItem[];
            names?: readonly string[];
            progress?: ExportProgressSink;
        }
    ) => Promise<ExportResult>;
};

/**
 * Drive a batch export from the Houses tab. With no `names`, exports every item
 * of the type; with `names`, only those (the tab's selection). The type-specific
 * work is the `spec.exportAll` the registry supplies (item capture, cache write,
 * etc.); this owns the shared destination/running-task guards, the post-export
 * reparse, and the result toasts. `onSuccess` fires only on a clean run — used
 * to clear the exported selection.
 */
export function startExport(
    spec: ExportSpec,
    names?: readonly string[],
    onSuccess?: () => void
): void {
    closeAllPopovers();
    const importJsonPath = getExportImportJsonPath();
    if (importJsonPath.trim() === "") {
        showToast("No import.json loaded — pick a destination first", 0xffe85c5c);
        return;
    }
    if (names !== undefined && names.length === 0) {
        showToast("Nothing selected to export", 0xffe5bc4b);
        return;
    }
    if (isTaskRunning() || TaskManager.hasRunningTasks()) {
        showToast("A task is already running — wait for it to finish", 0xffe5bc4b);
        return;
    }
    const dir = importJsonDir(importJsonPath);
    const count = names === undefined ? null : names.length;
    TaskManager.run(async (ctx) => {
        setActiveExportContext(ctx);
        setTaskRunning(true);
        let result: ExportResult;
        try {
            // Same boundary purge the importer does: nothing legit is waiting when
            // an export starts, so survivors are leaks — and a leaked packet waiter
            // re-runs its predicate on every packet, lagging input even with no
            // GUI open, until something purges it.
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
            }
            const destParse = getParseAt(importJsonPath);
            result = await spec.exportAll(ctx, {
                importJsonPath,
                rootDir: dir,
                names,
                // Seed capture matching with the destination's declared items
                // so re-exports reuse existing names instead of minting
                // duplicates. Warm-cache read; null just means no seeding.
                projectItems:
                    destParse?.parsed?.value.filter(
                        (imp): imp is ImportableItem => imp.type === "ITEM"
                    ) ?? [],
                // Feeds the same bottom progress strip the importer uses (verb
                // flips to "export"), sized in import cost-model units.
                progress: createExportProgressSink(spec.type, importJsonPath),
            });
        } finally {
            clearActiveExportContext(ctx);
            setTaskRunning(false);
        }
        // The export rewrote the destination import.json; drop its cached parse
        // so the Houses drift icons re-read it now instead of showing the
        // pre-export state until a fingerprint recheck happens to land.
        markParseStale(importJsonPath);
        // Export rewrote source + cache on disk. Force a reparse so the
        // cache-status dots rebuild against the fresh cache now, instead of
        // waiting out the parse-authority's settle throttle (~1s of red).
        if (result.failed > 0) {
            // Per-item failures are swallowed so the run finishes; surface them
            // here instead of reporting a partial run as a clean success.
            showToast(
                `Export finished with ${result.failed} failed, ${result.succeeded} ok → ${shortPath(importJsonPath)}`,
                0xffe85c5c,
                8000
            );
            return;
        }
        if (result.total === 0) {
            showToast(`No ${spec.label}s to export`, 0xffe5bc4b);
            return;
        }
        showToast(
            count === null
                ? `Exported all ${spec.label}s → ${shortPath(importJsonPath)}`
                : `Exported ${count} ${spec.label}${count === 1 ? "" : "s"} → ${shortPath(importJsonPath)}`,
            0xff5cb85c
        );
        if (onSuccess !== undefined) onSuccess();
    }).catch((err: unknown) => {
        showToast(`Export failed: ${err}`, 0xffe85c5c, 8000);
    });
}

function importJsonDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}
