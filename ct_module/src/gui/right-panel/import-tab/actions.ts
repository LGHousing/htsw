/// <reference types="../../../../CTAutocomplete" />

import {
    createImportRows,
    createImportProgress,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    clearImportableChecks,
    getAutoTrackSources,
    isAnyAutoTrackEnabled,
    isCurrentHouseTrusted,
    isImportableChecked,
    setActiveImportPath,
    setHousingUuid,
    setImportProgress,
    setKnowledgeRows,
    toggleImportableChecked,
} from "../../state";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueItem,
    type QueueItem,
} from "../../state/queue";
import { forEachCachedParse, getParseAt, parseImportJsonAt } from "../../state/parses";
import { buildCacheStatusRows } from "../../../importCache/status";
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
import { TaskManager } from "../../../tasks/manager";
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
import { traceProgressEvent } from "../../../importer/progress/trace";
import { invalidateKnowledgeOverlayForImportable } from "../../state/knowledgeOverlay";
import { showToast } from "../../toast";
import { setImportRunning } from "../../../importer/runtimeState";
import { gmcOnImportStart, playImportSuccessSound } from "../../../importer/sideEffects";
import { resetStepGate } from "../../../importer/stepGate";
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

function refreshKnowledgeRows(): void {
    const uuid = getHousingUuid();
    if (uuid === null) return;
    // Knowledge rows now aggregate across every cached parse so the
    // knowledge tab reflects every house touched by any queued or
    // recently-imported import.json, not just the legacy active one.
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
    setKnowledgeRows(buildCacheStatusRows(uuid, all));
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
                primeWithCache(activeViewPath, e.cached);
            }
        },
        importableFinished: (e) => {
            refreshKnowledgeRows();
            if (e.status === "imported") {
                const imp = importablesByKey.get(e.key);
                if (imp !== undefined) {
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
            const before = state.progress;
            state = reduce(state, event);
            traceProgressEvent(event, before, state.progress);
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
    const groups = new Map<string, { parsed: ParseResult<Importable[]>; ids: Set<string>; addAll: boolean }>();
    for (const item of queue) {
        // Make sure the parse is loaded (no-op if it's already cached).
        const cached = parseImportJsonAt(item.sourcePath);
        if (cached.parsed === null) {
            ChatLib.chat(`&c[htsw] Skipping ${item.sourcePath}: ${cached.error ?? "parse failed"}`);
            continue;
        }
        let group = groups.get(item.sourcePath);
        if (group === undefined) {
            group = { parsed: cached.parsed, ids: new Set<string>(), addAll: false };
            groups.set(item.sourcePath, group);
        }
        if (item.kind === "importJson") {
            group.addAll = true;
        } else {
            group.ids.add(`${item.type}:${item.identity}`);
        }
    }
    const batches: ImportBatch[] = [];
    for (const [sourcePath, g] of groups.entries()) {
        const wanted: Importable[] = [];
        for (const imp of g.parsed.value) {
            if (g.addAll) {
                wanted.push(imp);
                continue;
            }
            const k = `${imp.type}:${importableIdentity(imp)}`;
            if (g.ids.has(k)) wanted.push(imp);
        }
        if (wanted.length === 0) continue;
        const ordered = orderImportablesForImportSession(g.parsed.value, wanted);
        batches.push({ sourcePath, parsed: g.parsed, importables: ordered });
    }
    return batches.length === 0 ? null : batches;
}

function totalImportableCount(batches: ImportBatch[]): number {
    let n = 0;
    for (const b of batches) n += b.importables.length;
    return n;
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
    const batches = buildBatches(explicit);
    if (batches === null) {
        const msg =
            explicit !== undefined
                ? "Nothing matched the selection — try checking importables in the Importables tab first."
                : "Queue is empty — right-click something and Add to queue.";
        ChatLib.chat(`&c[htsw] ${msg}`);
        return;
    }
    const trustMode = isCurrentHouseTrusted();
    const total = totalImportableCount(batches);

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
    resetStepGate();
    gmcOnImportStart();

    TaskManager.run(async (ctx) => {
        const startedAt = Date.now();
        let importSucceeded = false;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalFailed = 0;
        try {
            ctx.displayMessage(
                `&7[import] starting ${total} importable${total === 1 ? "" : "s"} ` +
                    `across ${batches.length} import.json${batches.length === 1 ? "" : "s"} ` +
                    `· trust ${trustMode ? "on" : "off"}`
            );
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
            const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            ctx.displayMessage(
                `&7[import] done · imported ${totalImported}, skipped ${totalSkipped}, failed ${totalFailed}, ${elapsed}s`
            );
            importSucceeded = totalFailed === 0;
        } finally {
            setActiveImportPath(null);
            refreshKnowledgeRows();
            setImportRunning(false);
            if (importSucceeded) {
                playImportSuccessSound();
                showToast(
                    `Import complete · ${totalImported} imported, ${totalSkipped} skipped`,
                    0xff5cb85c
                );
            } else {
                showToast(
                    `Import finished with ${totalFailed} failed`,
                    0xffe85c5c
                );
            }
            setTimeout(() => {
                setImportProgress(null);
                if (explicit === undefined) { clearQueue(); clearImportableChecks(); }
            }, 5000);
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
