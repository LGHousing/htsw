import { Observers } from "../utils/observers";
import { conflictReviews } from "./events";
/// <reference types="../../CTAutocomplete" />

import { isCurrentHouseTrusted, isImportCompletionSoundEnabled } from "./state/index";
import {
    createTaskRows,
    createTaskProgress,
    finishTaskProgress,
    getTaskProgress,
    setActiveTaskPath,
    setTaskProgress,
    startTaskProgress,
} from "./taskProgress";
import {
    insertQueueRowsBefore,
    insertQueueRowsAfter,
    makeImportableQueueRow,
    setQueueRowStatus,
    type QueueRow,
} from "./queue";
import type { QueueSessionResult } from "./queueRunner";
import { parseImportJsonCurrent } from "./parsing/parses";
import { printDiagnostics } from "../tui/diagnostics";
import {
    orderImportablesForSession,
    runImportSession,
    type ImportConflictDecision,
} from "../importables/import/session";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { importableIdentity, importableKey } from "../importables/identity";
import { isTaskCancelled } from "../tasks/manager";
import { setTaskActivity } from "../tasks/activity";
import type { Importable } from "htsw/types";
import { attributeDiagnostics, type Diagnostic, type ImportablesParseResult } from "htsw";
import { importableSourcePath } from "./parsing/importablePaths";
import type { SyncEventHandler } from "../housingSync/syncEvents";
import { queueRowKey } from "../housingSync/progress/queueRowKey";
import { initialReducerState, reduce } from "../housingSync/progress/reducer";
import { traceSyncEvent } from "../housingSync/trace/taskTrace";
import { traceProgressEvent } from "../housingSync/trace/progressTrace";
import { showToast } from "./events";
import { playImportSuccessSound } from "../housingSync/sideEffects";
import { formatElapsedSeconds } from "./elapsed";
import { autoTrackRefresh } from "./autoTrack";
import { openAnswerableConflictPrompt } from "./conflictPrompt";
import type { ImportConflict } from "../importables/import/conflicts";
import type TaskContext from "../tasks/context";
import { conflictAwaitingConfirmationMessage } from "../importables/import/conflictChat";
import { emitBridgeEvent, finishBridgeSession } from "../bridge/status";

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
    const slot = basePath.match(/^slot#(\d+)\.actions$/);
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
    conflicts: readonly ImportConflict[]
): Promise<ImportConflictDecision> {
    const review = { requested: false };
    const proceed = await openAnswerableConflictPrompt(ctx, {
        chatMessage: conflictAwaitingConfirmationMessage(conflicts),
        chatConfirmAction: "import anyway",
        chatRefuseAction: "cancel the import",
        title: "Housing changed since your last import",
        lines: conflictLines(conflicts),
        confirmLabel: "Import anyway",
        extraLabel: "See changes",
        danger: true,
        onExtra: () => {
            review.requested = true;
        },
    });
    if (proceed) return "proceed";
    return review.requested ? "review" : "cancel";
}

export type ImportSessionObservation = {
    parsed: ImportablesParseResult;
    sessionSourcePath: string;
    trustMode: boolean;
    housingUuid: string;
};
export const importSessions = new Observers<{
    args: ImportSessionObservation;
    observe: (handler: SyncEventHandler) => void;
}>();

type SessionEventHandler = SyncEventHandler & {
    counts(): { imported: number; skipped: number; failed: number };
    rows(): readonly { key: string; status: string }[];
};

function createSyncEventHandler(args: ImportSessionObservation): SessionEventHandler {
    let state = initialReducerState();
    let activeViewPath: string | null = null;
    const importablesByKey = new Map<string, Importable>();
    for (const imp of args.parsed.value) {
        importablesByKey.set(
            queueRowKey(imp.type, importableIdentity(imp), args.sessionSourcePath),
            imp
        );
    }
    const observers: SyncEventHandler[] = [];
    importSessions.emit({ args, observe: (handler) => observers.push(handler) });
    return {
        emit(event) {
            const before = state.progress;
            state = reduce(state, event);
            traceProgressEvent(event, before, state.progress);
            traceSyncEvent(event);
            if (
                event.kind === "importableStarted" ||
                event.kind === "importableReactivated"
            ) {
                const imp = importablesByKey.get(event.key);
                activeViewPath =
                    imp === undefined ? null : (importableSourcePath(imp) ?? null);
            } else if (event.kind === "sessionFinished") {
                activeViewPath = null;
            } else if (event.kind === "sessionTotalsLocked") {
                emitBridgeEvent("htsw_plan", {
                    status: "completed",
                    rows: event.plannedRows,
                    sessionApplicationUnits: event.sessionApplicationUnits,
                });
            }
            for (const observer of observers) observer.emit(event);
            if (state.progress !== before) setTaskProgress(state.progress);
            setActiveTaskPath(activeViewPath);
        },
        counts() {
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
        rows: () => state.progress.rows,
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
    retainedKeys: readonly string[];
};

function conflictedImportables(request: ConflictReviewRequest): Importable[] {
    const byKey = importablesByKey(request.batch.parsed);
    const resolved: Importable[] = [];
    const seen = new Set<string>();
    for (const conflict of request.conflicts) {
        const key = importableKey(conflict.type, conflict.identity);
        if (seen.has(key)) continue;
        seen.add(key);
        const importable = byKey.get(key);
        if (importable !== undefined) resolved.push(importable);
    }
    return resolved;
}

function prepareConflictReview(
    request: ConflictReviewRequest,
    importRows: readonly QueueRow[]
): NonNullable<QueueSessionResult["completionHooks"]>[number] {
    const importables = conflictedImportables(request);
    const retained = new Set(request.retainedKeys);
    const remaining = importables.filter(
        (importable) =>
            !retained.has(importableKey(importable.type, importableIdentity(importable)))
    );
    const firstSourcePath =
        importables.length > 0 ? importableSourcePath(importables[0]) : undefined;
    const openReview = (message: string): void => {
        if (firstSourcePath !== undefined) {
            conflictReviews.emit({
                path: firstSourcePath,
                sourcePath: request.batch.sourcePath,
            });
        }
        ChatLib.chat(message);
    };
    const readRows = insertQueueRowsBefore(
        importRows[0].key,
        remaining.map((importable) =>
            makeImportableQueueRow({
                op: "read",
                house: importRows[0].house,
                path: request.batch.sourcePath,
                type: importable.type,
                identity: importableIdentity(importable),
                label: importable.type === "EVENT" ? importable.event : importable.name,
                origin: "dependency",
            })
        )
    );
    return {
        keys: readRows.map((row) => row.key),
        callback: () =>
            openReview(
                readRows.length === 0
                    ? "&7[htsw] Kept the changed lists from this import — the View tab shows what changed in Housing."
                    : "&7[htsw] Kept the available changes and read the remaining lists — the View tab shows what changed in Housing."
            ),
    };
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
async function buildBatches(queue: readonly QueueRow[]): Promise<ImportBatch[] | null> {
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
        let group = groups.get(item.path);
        if (group === undefined) {
            const cached = await parseImportJsonCurrent(item.path);
            if (cached.parsed === null) {
                ChatLib.chat(
                    `&c[htsw] Skipping ${item.path}: ${cached.error ?? "parse failed"}`
                );
                continue;
            }
            group = {
                parsed: cached.parsed,
                orderedIds: [],
                seen: new Set<string>(),
                addAll: false,
            };
            groups.set(item.path, group);
        }
        if (item.target.kind === "bulk") {
            group.addAll = true;
        } else {
            const k = `${item.target.type}:${item.target.identity}`;
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

export async function runImportQueueSession(
    ctx: TaskContext,
    rows: readonly QueueRow[],
    housingUuid: string
): Promise<QueueSessionResult> {
    const importRows = rows.filter(
        (
            row
        ): row is QueueRow & {
            target: Extract<QueueRow["target"], { kind: "importable" }>;
        } => row.op === "import" && row.target.kind === "importable"
    );
    if (importRows.length === 0) return { completedKeys: [], failed: [] };

    setTaskActivity("Reading the project");
    const batches = await buildBatches(importRows);
    if (batches === null) {
        const message = "Nothing matched the queued import selection.";
        ChatLib.chat(`&c[htsw] Import failed: ${message}`);
        return {
            completedKeys: [],
            failed: [{ key: importRows[0].key, error: message }],
        };
    }
    const failedParses = batches
        .map((batch) => ({ batch, errors: relevantParseErrors(batch) }))
        .filter((entry) => entry.errors.length > 0);
    if (failedParses.length > 0) {
        ChatLib.chat(
            `&c[htsw] Import aborted — ${failedParses.length} file${failedParses.length === 1 ? "" : "s"} ` +
                "with errors. Fix the diagnostics below and retry."
        );
        for (const { batch, errors } of failedParses) {
            ChatLib.chat(`&7  in ${batch.sourcePath}:`);
            printDiagnostics(batch.parsed.gcx.sourceMap, errors);
        }
        return {
            completedKeys: [],
            failed: [{ key: importRows[0].key, error: "Import file has errors" }],
            parseError: true,
        };
    }

    const batch = batches[0];
    const trustMode = isCurrentHouseTrusted();
    setTaskActivity("Working out what the import needs");
    const expansion = expandImportDependencies(
        batch.parsed,
        batch.importables,
        housingUuid,
        { trustMode, importJsonPath: batch.sourcePath }
    );
    batch.importables = expansion.importables;
    const queueRowsByProgressKey = new Map<string, QueueRow>();
    for (const row of importRows) {
        queueRowsByProgressKey.set(
            queueRowKey(row.target.type, row.target.identity, row.path),
            row
        );
    }
    if (expansion.addedImportables.length > 0) {
        const dependencyRows = expansion.addedImportables.map((importable) =>
            makeImportableQueueRow({
                op: "import",
                house: importRows[0].house,
                path: batch.sourcePath,
                type: importable.type,
                identity: importableIdentity(importable),
                label: importable.type === "EVENT" ? importable.event : importable.name,
                origin: "dependency",
            })
        );
        const inserted = insertQueueRowsAfter(
            importRows[importRows.length - 1].key,
            dependencyRows
        );
        for (const row of inserted) {
            setQueueRowStatus(row.key, "running");
            if (row.target.kind !== "importable") continue;
            queueRowsByProgressKey.set(
                queueRowKey(row.target.type, row.target.identity, row.path),
                row
            );
        }
    }

    const allErrors = relevantParseErrors(batch);
    if (allErrors.length > 0) {
        ChatLib.chat(
            "&c[htsw] Import aborted — required dependencies contain errors. Fix the diagnostics below and retry."
        );
        printDiagnostics(batch.parsed.gcx.sourceMap, allErrors);
        return {
            completedKeys: [],
            failed: [{ key: importRows[0].key, error: "Import dependency has errors" }],
            parseError: true,
        };
    }

    startTaskProgress({
        progress: createTaskProgress({
            totalUnits: 1,
            rows: createTaskRows(batch.importables, batch.sourcePath),
        }),
        verb: "import",
        path: batch.sourcePath,
    });
    const events = createSyncEventHandler({
        parsed: batch.parsed,
        sessionSourcePath: batch.sourcePath,
        trustMode,
        housingUuid,
    });
    let cancelled = false;
    const reviewState: { request: ConflictReviewRequest | null } = { request: null };
    try {
        await runImportSession(ctx, {
            importables: batch.importables,
            trustMode,
            housingUuid,
            sourcePath: batch.sourcePath,
            parsed: batch.parsed,
            events,
            conflictHandling: {
                kind: "prompt",
                decide: async (conflicts) => {
                    const decision = await confirmImportConflicts(ctx, conflicts);
                    if (decision === "review") {
                        reviewState.request = {
                            batch,
                            conflicts,
                            retainedKeys: [],
                        };
                    }
                    if (decision !== "proceed") {
                        cancelled = true;
                        ChatLib.chat("[htsw] Import cancelled by user · 0 imported");
                    }
                    return decision;
                },
                onReviewPrepared: (retainedKeys) => {
                    if (reviewState.request !== null) {
                        reviewState.request.retainedKeys = retainedKeys;
                    }
                },
            },
            onImportableAutoAdded: (importable) => {
                const dependency = makeImportableQueueRow({
                    op: "import",
                    house: importRows[0].house,
                    path: batch.sourcePath,
                    type: importable.type,
                    identity: importableIdentity(importable),
                    label:
                        importable.type === "EVENT" ? importable.event : importable.name,
                    origin: "dependency",
                });
                const inserted = insertQueueRowsAfter(
                    importRows[importRows.length - 1].key,
                    [dependency]
                );
                for (const row of inserted) {
                    setQueueRowStatus(row.key, "running");
                    if (row.target.kind === "importable") {
                        queueRowsByProgressKey.set(
                            queueRowKey(row.target.type, row.target.identity, row.path),
                            row
                        );
                    }
                }
            },
        });
    } catch (error) {
        if (!isTaskCancelled(error)) throw error;
        cancelled = true;
        const counts = events.counts();
        ChatLib.chat(
            `&e[htsw] Import cancelled by user &7· &f${counts.imported}&e imported`
        );
    }

    const counts = events.counts();
    const elapsed = formatElapsedSeconds(ctx.elapsedMs() / 1000);
    if (!cancelled && counts.failed === 0) {
        if (isImportCompletionSoundEnabled()) playImportSuccessSound();
        showToast(
            `Import complete in ${elapsed} · ${counts.imported} imported, ${counts.skipped} skipped`,
            0xff5cb85c
        );
        ChatLib.chat(
            `&a[htsw] Import complete in ${elapsed} &7· &f${counts.imported}&a imported, &f${counts.skipped}&7 skipped`
        );
    }

    const completedKeys: string[] = [];
    const failed: Array<{ key: string; error: string }> = [];
    for (const progressRow of events.rows()) {
        const queueRow = queueRowsByProgressKey.get(progressRow.key);
        if (queueRow === undefined) continue;
        if (progressRow.status === "imported" || progressRow.status === "skipped") {
            completedKeys.push(queueRow.key);
        } else if (progressRow.status === "failed") {
            const message = getTaskProgress()?.failure?.message ?? "Import failed";
            failed.push({ key: queueRow.key, error: message });
        }
    }
    finishBridgeSession(
        cancelled ? "cancelled" : failed.length > 0 ? "failed" : "completed",
        { ...counts, elapsedMs: ctx.elapsedMs() }
    );
    finishTaskProgress(failed[0]?.error ?? null);
    autoTrackRefresh();
    if (reviewState.request !== null) {
        const sessionKeys = Array.from(
            new Set(Array.from(queueRowsByProgressKey.values()).map((row) => row.key))
        );
        const completionHook = prepareConflictReview(reviewState.request, importRows);
        return {
            completedKeys: [],
            failed: [],
            cancelledKeys: sessionKeys,
            completionHooks: [completionHook],
        };
    }
    return { completedKeys, failed, cancelled };
}
