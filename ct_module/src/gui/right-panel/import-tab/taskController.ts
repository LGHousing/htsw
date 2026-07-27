/// <reference types="../../../../CTAutocomplete" />

import {
    getHousingUuid,
    isCurrentHouseTrusted,
    isImportCompletionSoundEnabled,
    setHousingUuid,
} from "../../state";
import {
    createTaskRows,
    createTaskProgress,
    clearLastFinishedProgress,
    finishTaskProgress,
    getTaskProgress,
    setActiveTaskPath,
    setSessionTrustMode,
    setTaskProgress,
} from "./taskProgress";
import {
    addSessionQueueItem,
    addToQueue,
    beginQueueSession,
    endQueueSession,
    getQueue,
    isImportQueueItem,
    makeImportableQueueItem,
    queueItemKey,
    removeFromQueueKey,
    type ImportQueueItem,
} from "./queue";
import { parseImportJsonCurrent } from "../../parsing/parses";
import { printDiagnostics } from "../../../tui/diagnostics";
import {
    orderImportablesForSession,
    runImportSession,
} from "../../../importables/import/session";
import { expandImportDependencies } from "../../../importables/import/dependencyExpansion";
import { importableIdentity } from "../../../importables/identity";
import { HOUSE_READERS } from "../../../importables/export/readers";
import { getCurrentHousingUuid } from "../../../importCache/housingId";
import { TaskManager, isTaskCancelled } from "../../../tasks/manager";
import type { Importable } from "htsw/types";
import { attributeDiagnostics, type Diagnostic, type ImportablesParseResult } from "htsw";
import { importableSourcePath } from "../../parsing/importablePaths";
import type { SyncEventHandler, SyncEvent } from "../../../housingSync/syncEvents";
import { queueRowKey } from "../../../housingSync/progress/queueRowKey";
import { initialReducerState, reduce } from "../../../housingSync/progress/reducer";
import { traceSyncEvent } from "../../../housingSync/trace/taskTrace";
import { traceProgressEvent } from "../../../housingSync/trace/progressTrace";
import { invalidateSourceDiffForImportable } from "../../code-view/sourceDiff";
import { showToast } from "../../toast";
import { isTaskRunning } from "../../../tasks/runningState";
import {
    gmcOnImportStart,
    playImportSuccessSound,
    waitForCreativeMode,
} from "../../../housingSync/sideEffects";
import { runHousingSyncTask } from "../../../housingSync/taskRunner";
import {
    applyComplete,
    finalizeFromSource,
    markHeadApplied,
    markMatch,
    markPreviewCompleted,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    primeWithCache,
    rebaseToDesired,
    resetPreview,
    setCurrent,
    setLiveSummary,
    setObservedTopLevel,
} from "./livePreview";
import { ActionPath } from "../../../housingSync/actionPath";
import { setFocusPath } from "./focusedLine";
import { autoTrackRefresh } from "../../autoTrack";
import { closeConfirmPopover, openConfirmPopover } from "../../popovers/confirm";
import type { ImportConflict } from "../../../importables/import/conflicts";
import type TaskContext from "../../../tasks/context";
import { previewSelect } from "../selection";
import { startDeepRead, type DeepReadSpec } from "../../knowledge/deepRead";
import { resetLivePreviewScroll } from "../view-body";
import { conflictAwaitingConfirmationMessage } from "../../../importables/import/conflictChat";

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error !== null && typeof error === "object") {
        if ("message" in error && typeof error.message === "string") {
            return error.message;
        }
        try {
            const serialized: unknown = JSON.stringify(error);
            if (typeof serialized === "string") return serialized;
        } catch (_e) {}
        return "Unknown error";
    }
    return String(error);
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

const CONFLICT_TYPE_LABEL: Partial<Record<ImportConflict["type"], string>> = {
    FUNCTION: "Function",
    COMMAND: "Command",
    EVENT: "Event",
    REGION: "Region",
    NPC: "NPC",
    MENU: "Menu",
};

function conflictListLabel(basePath: string): string {
    if (basePath === "actions") return "actions";
    if (basePath === "onEnterActions") return "enter actions";
    if (basePath === "onExitActions") return "exit actions";
    if (basePath === "leftClickActions") return "left-click actions";
    if (basePath === "rightClickActions") return "right-click actions";
    const slot = basePath.match(/^slots\[(\d+)\]\.actions$/);
    if (slot !== null) return `slot ${slot[1]} actions`;
    return basePath;
}

function conflictSubject(type: ImportConflict["type"], identity: string): string {
    const label = CONFLICT_TYPE_LABEL[type] ?? type;
    if (type === "NPC") {
        return `NPC at ${identity.split(",").join(", ")}`;
    }
    return `${label} "${identity}"`;
}

function conflictLines(conflicts: readonly ImportConflict[]): string[] {
    const groups: Array<{
        type: ImportConflict["type"];
        identity: string;
        paths: string[];
    }> = [];
    const byImportable = new Map<string, (typeof groups)[number]>();
    for (const conflict of conflicts) {
        const key = `${conflict.type}:${conflict.identity}`;
        let group = byImportable.get(key);
        if (group === undefined) {
            group = { type: conflict.type, identity: conflict.identity, paths: [] };
            byImportable.set(key, group);
            groups.push(group);
        }
        if (group.paths.indexOf(conflict.basePath) < 0) {
            group.paths.push(conflict.basePath);
        }
    }

    const lines = groups.map((group) => {
        const subject = conflictSubject(group.type, group.identity);
        // A lone "actions" list is the type's only list (functions, commands,
        // events) — naming it adds nothing over the subject itself.
        if (group.paths.length === 1 && group.paths[0] === "actions") {
            return subject;
        }
        return `${subject} — ${group.paths.map(conflictListLabel).join(", ")}`;
    });
    const visible = lines.slice(0, 10);
    if (lines.length > visible.length) {
        visible.push(`…and ${lines.length - visible.length} more`);
    }
    return ["Someone edited these in Housing after your last import:", ...visible];
}

async function confirmImportConflicts(
    ctx: TaskContext,
    conflicts: readonly ImportConflict[],
    onReview: () => void
): Promise<boolean> {
    let decision: boolean | null = null;
    const decide = (value: boolean): void => {
        if (decision === null) decision = value;
    };
    const currentDecision = (): boolean | null => decision;

    ChatLib.chat(conflictAwaitingConfirmationMessage(conflicts));
    openConfirmPopover({
        title: "Housing changed since your last import",
        lines: conflictLines(conflicts),
        confirmLabel: "Import anyway",
        extraLabel: "See changes",
        danger: true,
        onConfirm: () => decide(true),
        onExtra: () => {
            onReview();
            decide(false);
        },
        onClose: () => decide(false),
    });
    try {
        for (;;) {
            const current = currentDecision();
            if (current !== null) return current;
            await ctx.sleep(50);
        }
    } finally {
        closeConfirmPopover();
    }
}

const BODY_LIST_PROPS: Record<string, true | undefined> = {
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
            activeViewPath = imp === null ? null : (importableSourcePath(imp) ?? null);
            if (activeViewPath !== null) {
                resetPreview(activeViewPath);
                primeWithCache(activeViewPath, e.cached, { shellOnly: !args.trustMode });
                resetLivePreviewScroll();
            }
        },
        importableFinished: (e) => {
            const imp = importablesByKey.get(e.key);
            if (imp === undefined) return;
            const sourcePath = importableSourcePath(imp);
            if (sourcePath !== undefined && e.status !== "failed") {
                markPreviewCompleted(sourcePath);
            }
            if (e.status === "imported") invalidateSourceDiffForImportable(imp);
        },
        importableReactivated: (e) => {
            // Application reactivates an importable parked after observation.
            // Re-bind the preview to this row's source file so the applying
            // diff overlay lands in the right pane.
            const imp = importablesByKey.get(e.key) ?? null;
            activeViewPath = imp === null ? null : (importableSourcePath(imp) ?? null);
        },
        sessionTotalsLocked: () => {},
        sessionApplicationProgress: () => {},
        applicationProgress: () => {},
        sessionFinished: () => {
            activeViewPath = null;
        },
        progress: () => {},
        knowledgeSourceUsed: () => {},
        // Slot focus lives on the progress snapshot (set by the reducer); the
        // panel reads it from there. Nothing to mirror into the code view.
        menuSlotStarted: () => {},
        setupStep: () => {},
        readStarted: () => {},
        childListReadStarted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, e.path);
            setFocusPath(activeViewPath, e.path);
        },
        diffPlanned: (e) => {
            if (activeViewPath === null) return;
            setLiveSummary(activeViewPath, e.summary);
            if (e.operations.length > 0) {
                rebaseToDesired(
                    activeViewPath,
                    ActionPath.containingList(e.operations[0].path),
                    e.operations,
                    e.matches
                );
            } else if (e.matches.length > 0) {
                rebaseToDesired(
                    activeViewPath,
                    ActionPath.containingList(e.matches[0]),
                    e.operations,
                    e.matches
                );
            }
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
                } else {
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
            setFocusPath(activeViewPath, e.path);
        },
        operationCompleted: (e) => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, null);
            applyComplete(activeViewPath, e.path, e.finalState, e.op);
        },
        listSyncCompleted: () => {
            if (activeViewPath === null) return;
            setCurrent(activeViewPath, null);
            setFocusPath(activeViewPath, null);
        },
        observedSnapshot: (e) => {
            if (activeViewPath !== null) setObservedTopLevel(activeViewPath, e.nodes);
        },
        actionReadCompleted: () => {},
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
            if (state.progress !== before) {
                setTaskProgress(state.progress);
            }
            setActiveTaskPath(activeViewPath);
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

const importablesByKeyByParse = new WeakMap<
    ImportablesParseResult,
    Map<string, Importable>
>();

function importablesByKey(parsed: ImportablesParseResult): Map<string, Importable> {
    const cached = importablesByKeyByParse.get(parsed);
    if (cached !== undefined) return cached;
    const byKey = new Map<string, Importable>();
    for (const imp of parsed.value) {
        byKey.set(`${imp.type}:${importableIdentity(imp)}`, imp);
    }
    importablesByKeyByParse.set(parsed, byKey);
    return byKey;
}

type ConflictReviewRequest = {
    batch: ImportBatch;
    conflicts: readonly ImportConflict[];
    housingUuid: string;
};

function conflictedImportables(request: ConflictReviewRequest): Importable[] {
    const byKey = importablesByKey(request.batch.parsed);

    const resolved: Importable[] = [];
    const seen = new Set<string>();
    for (const conflict of request.conflicts) {
        const key = `${conflict.type}:${conflict.identity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const imp = byKey.get(key);
        if (imp !== undefined) resolved.push(imp);
    }
    return resolved;
}

function startConflictReview(request: ConflictReviewRequest): void {
    const importables = conflictedImportables(request);
    if (importables.length === 0) return;

    const specsByType = new Map<Importable["type"], DeepReadSpec & { names: string[] }>();
    for (const imp of importables) {
        const read = HOUSE_READERS[imp.type];
        if (read === null) continue;
        let spec = specsByType.get(imp.type);
        if (spec === undefined) {
            spec = {
                type: imp.type,
                label: (CONFLICT_TYPE_LABEL[imp.type] ?? imp.type).toLowerCase(),
                read,
                names: [],
            };
            specsByType.set(imp.type, spec);
        }
        spec.names.push(importableIdentity(imp));
    }

    const firstSourcePath = importableSourcePath(importables[0]);
    startDeepRead(Array.from(specsByType.values()), {
        housingUuid: request.housingUuid,
        importJsonPath: request.batch.sourcePath,
        parsed: request.batch.parsed,
        summaryLabel: "changed importable",
        onSuccess: () => {
            if (firstSourcePath !== undefined) {
                previewSelect(firstSourcePath, request.batch.sourcePath);
            }
            ChatLib.chat(
                "&7[htsw] Read the changed lists — the View tab shows what changed in Housing."
            );
        },
    });
}

/**
 * Group queued items by their declaring import.json so we can hand each
 * batch to a single `runImportSession` call (which assumes one
 * shared `sourcePath` across all importables it processes). `importJson`
 * items expand to every importable in their parse; `importable` items
 * resolve to the matching object inside the parse.
 *
 * Returns null when nothing in the queue could be resolved — the caller
 * uses that to short-circuit with a friendly chat message.
 */
async function buildBatches(
    explicit?: readonly ImportQueueItem[]
): Promise<ImportBatch[] | null> {
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
        let group = groups.get(item.sourcePath);
        if (group === undefined) {
            const cached = await parseImportJsonCurrent(item.sourcePath);
            if (cached.parsed === null) {
                ChatLib.chat(
                    `&c[htsw] Skipping ${item.sourcePath}: ${cached.error ?? "parse failed"}`
                );
                continue;
            }
            group = {
                parsed: cached.parsed,
                orderedIds: [],
                seen: new Set<string>(),
                addAll: false,
            };
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
        const byKey = importablesByKey(g.parsed);
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
        const ordered = orderImportablesForSession(g.parsed.value, wanted);
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

let importPreparationRunning = false;

export function isImportPreparationRunning(): boolean {
    return importPreparationRunning;
}

export function startImport(
    explicit?: readonly ImportQueueItem[],
    options: ImportStartOptions = {}
): void {
    startImportIfIdle(explicit, options);
}

type ImportStartOptions = {
    onConflict?: "prompt" | "cancel";
    fresh?: boolean;
    silentBusy?: boolean;
    onStarted?: () => void;
    onComplete?: (successful: boolean) => void;
    onAbortedForErrors?: () => void;
};

export function startImportIfIdle(
    explicit?: readonly ImportQueueItem[],
    options: ImportStartOptions = {}
): boolean {
    if (TaskManager.isBusy() || importPreparationRunning) {
        if (options.silentBusy !== true) {
            ChatLib.chat(
                "&c[htsw] An import (or another task) is already running — wait for it to finish or cancel it first."
            );
        }
        return false;
    }
    importPreparationRunning = true;
    void prepareAndStartImport(explicit, options).then(
        () => {
            importPreparationRunning = false;
        },
        (error: unknown) => {
            importPreparationRunning = false;
            ChatLib.chat(`&c[htsw] Couldn't prepare import: ${String(error)}`);
        }
    );
    return true;
}

async function prepareAndStartImport(
    explicit: readonly ImportQueueItem[] | undefined,
    options: ImportStartOptions
): Promise<void> {
    if (TaskManager.isBusy()) {
        if (options.silentBusy !== true) {
            ChatLib.chat(
                "&c[htsw] An import (or another task) is already running — wait for it to finish or cancel it first."
            );
        }
        return;
    }
    const batches = await buildBatches(explicit);
    if (TaskManager.isBusy()) {
        if (options.silentBusy !== true) {
            ChatLib.chat(
                "&c[htsw] Another task started while the project was being checked."
            );
        }
        return;
    }
    if (batches === null) {
        const msg =
            explicit !== undefined
                ? "Nothing matched the selection — try checking importables in the Projects tab first."
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
        options.onAbortedForErrors?.();
        return;
    }
    const trustMode = isCurrentHouseTrusted();
    const selectedCount = batches.reduce(
        (total, batch) => total + batch.importables.length,
        0
    );
    const dependencyAdditions: Array<{
        importable: Importable;
        sourcePath: string;
    }> = [];
    let addedItemCount = 0;
    const knownHousingUuid = getHousingUuid();
    if (knownHousingUuid !== null) {
        for (const batch of batches) {
            const expansion = expandImportDependencies(
                batch.parsed,
                batch.importables,
                knownHousingUuid
            );
            batch.importables = expansion.importables;
            addedItemCount += expansion.addedItems.length;
            for (const importable of expansion.addedImportables) {
                dependencyAdditions.push({
                    importable,
                    sourcePath: batch.sourcePath,
                });
            }
        }
    }

    // Concatenate every batch's ordered importables for the run-row
    // tracking; the per-row UI only needs the flat list, not the
    // per-batch grouping.
    let rows = createTaskRows(batches[0].importables, batches[0].sourcePath);
    for (let i = 1; i < batches.length; i++) {
        rows = rows.concat(createTaskRows(batches[i].importables, batches[i].sourcePath));
    }
    setTaskProgress(
        createTaskProgress({
            totalUnits: 1,
            rows,
        })
    );
    setSessionTrustMode(trustMode);
    setActiveTaskPath(batches[0].sourcePath);

    // A command import (`explicit`) gets reflected into the visible queue so
    // it shows up + animates like a GUI run; otherwise we'd run an invisible
    // import with an empty queue. Add the explicit items first, THEN snapshot
    // the session keys to exactly those — pre-existing queue items get
    // session-marked by beginQueueSession but must NOT be cleaned up here,
    // since the explicit batch only ran what `explicit` named.
    if (explicit !== undefined) {
        for (const item of explicit) addToQueue(item);
    }
    for (const addition of dependencyAdditions) {
        addToQueue(
            makeImportableQueueItem(addition.importable, addition.sourcePath)
        );
    }
    beginQueueSession();

    // Snapshot this session's queue keys so the post-run cleanup can drop
    // exactly these items even if a newer import supersedes the session.
    const sessionItemKeys: string[] = (
        explicit ?? getQueue().filter(isImportQueueItem)
    ).map(queueItemKey);
    if (explicit !== undefined) {
        for (const addition of dependencyAdditions) {
            const key = queueItemKey(
                makeImportableQueueItem(addition.importable, addition.sourcePath)
            );
            if (sessionItemKeys.indexOf(key) < 0) sessionItemKeys.push(key);
        }
    }
    if (dependencyAdditions.length > 0) {
        const totalCount = batches.reduce(
            (total, batch) => total + batch.importables.length,
            0
        );
        const dependencyLabel =
            addedItemCount === dependencyAdditions.length
                ? `${addedItemCount} required click-action item${addedItemCount === 1 ? "" : "s"}`
                : `${dependencyAdditions.length} required dependenc${dependencyAdditions.length === 1 ? "y" : "ies"}`;
        showToast(
            `Queued ${dependencyLabel} · ${selectedCount} selected → ${totalCount} total`,
            0xff5c9ded,
            8000
        );
    }
    let reviewRequest: ConflictReviewRequest | null = null;
    options.onStarted?.();

    runHousingSyncTask("import", async (ctx) => {
        gmcOnImportStart();
        let importSucceeded = false;
        let cancelled = false;
        const sessionCancelled = (): boolean => cancelled;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalFailed = 0;
        let unexpectedError: unknown = null;
        try {
            const cached = getHousingUuid();
            let housingUuid = cached;
            if (housingUuid === null) {
                housingUuid = await getCurrentHousingUuid(ctx);
                setHousingUuid(housingUuid);
            }
            if (!(await waitForCreativeMode(ctx))) {
                ChatLib.chat(
                    "&e[htsw] Still not in creative after /gmc — item spawns may fail. Check your gamemode permissions on this plot."
                );
            }
            for (const batch of batches) {
                const events = createSyncEventHandler({
                    parsed: batch.parsed,
                    sessionSourcePath: batch.sourcePath,
                    trustMode,
                    housingUuid,
                });
                await runImportSession(ctx, {
                    importables: batch.importables,
                    trustMode,
                    housingUuid,
                    sourcePath: batch.sourcePath,
                    freshHydration: options.fresh,
                    parsed: batch.parsed,
                    events,
                    confirmConflicts: async (conflicts) => {
                        if (options.onConflict === "cancel") {
                            cancelled = true;
                            ChatLib.chat(
                                `[htsw] Import cancelled: conflicts detected · ${totalImported} imported`
                            );
                            return false;
                        }
                        const proceed = await confirmImportConflicts(
                            ctx,
                            conflicts,
                            () => {
                                reviewRequest = {
                                    batch,
                                    conflicts: conflicts.slice(),
                                    housingUuid,
                                };
                            }
                        );
                        if (!proceed) {
                            cancelled = true;
                            ChatLib.chat(
                                `[htsw] Import cancelled by user · ${totalImported} imported`
                            );
                        }
                        return proceed;
                    },
                    onImportableAutoAdded: (importable) => {
                        const queueItem = makeImportableQueueItem(
                            importable,
                            batch.sourcePath
                        );
                        addSessionQueueItem(queueItem);
                        // Track it with this session's keys so the
                        // post-success cleanup removes it like any other
                        // session row.
                        const key = queueItemKey(queueItem);
                        if (sessionItemKeys.indexOf(key) < 0) {
                            sessionItemKeys.push(key);
                        }
                    },
                });
                const c = events.counts();
                totalImported += c.imported;
                totalSkipped += c.skipped;
                totalFailed += c.failed;
                if (sessionCancelled()) break;
                // A failed importable can leave the Housing menu mid-edit, so
                // the menu state for the next batch is unknown. Abort the run
                // rather than drive unrelated files from an uncertain menu.
                if (c.failed > 0) break;
            }
            importSucceeded = totalFailed === 0 && !cancelled;
        } catch (err) {
            if (isTaskCancelled(err)) {
                cancelled = true;
            } else {
                unexpectedError = err;
            }
        } finally {
            setActiveTaskPath(null);
            options.onComplete?.(importSucceeded);
            autoTrackRefresh();
            const elapsed = formatElapsedSeconds(ctx.elapsedMs() / 1000);
            let failureMessage: string | null = null;
            if (cancelled) {
                showToast(
                    `Import cancelled after ${elapsed} · ${totalImported} imported`,
                    0xffe5bc4b
                );
            } else if (importSucceeded) {
                // Gate our own cue here: the overlay soundPlay interceptor only
                // suppresses sounds while task progress is live, and this fires
                // at completion — so the toggle must be checked directly.
                if (isImportCompletionSoundEnabled()) playImportSuccessSound();
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
                failureMessage =
                    failure?.message ??
                    (unexpectedError === null
                        ? `${totalFailed} failed`
                        : errorMessage(unexpectedError));
                showToast(`Import failed: ${failureMessage}`, 0xffe85c5c, 8000);
            }
            finishTaskProgress(failureMessage);
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
                // A conflict review is a separate read task, so it must not
                // strand the import session while it runs.
                if (!isTaskRunning() || reviewRequest !== null) {
                    endQueueSession(false);
                    if (removeSessionItems || cancelled) clearLastFinishedProgress();
                }
            }, 1500);
        }
        if (unexpectedError !== null) {
            if (unexpectedError instanceof Error) throw unexpectedError;
            throw new Error(errorMessage(unexpectedError));
        }
    })
        .then(() => {
            if (reviewRequest !== null) startConflictReview(reviewRequest);
        })
        .catch((err: unknown) => {
            ChatLib.chat(`&c[htsw] Import failed: ${String(err)}`);
        });
}
