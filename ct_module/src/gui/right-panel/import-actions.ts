/// <reference types="../../../CTAutocomplete" />

import {
    applyImportProgress,
    beginImportRun,
    clearImportRun,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    isCurrentHouseTrusted,
    setCurrentImportingPath,
    setHousingUuid,
    setImportProgress,
    setKnowledgeRows,
    updateImportRunFromProgress,
} from "../state";
import {
    clearQueue,
    getQueue,
    type QueueItem,
} from "../state/queue";
import { forEachCachedParse, getParseAt, parseImportJsonAt } from "../state/parses";
import { buildKnowledgeStatusRows } from "../../knowledge/status";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
    type ImportSelection,
} from "../../importables/importSession";
import { exportImportable } from "../../importables/exports";
import {
    captureFromHousing,
    type CaptureType,
} from "../../exporter/captureFromHousing";
import { importableIdentity } from "../../knowledge/paths";
import { trustPlanKey } from "../../knowledge/trust";
import { getCurrentHousingUuid } from "../../knowledge/housingId";
import { TaskManager } from "../../tasks/manager";
import type { Importable } from "htsw/types";
import type { ParseResult } from "htsw";
import { closeAllPopovers } from "../lib/popovers";
import { htslFilenameForFunctionExport } from "../../exporter/paths";
import {
    clearDiff,
    addDeleteOp,
    diffKey,
    markCompleted,
    setCurrent,
    setDiffState,
    setDiffPhase,
    setDiffSummary,
    setPlannedOp,
} from "../state/diff";
import {
    finalizeFromSource,
    markHeadApplied,
    markPlannedAdd,
    markPlannedDelete,
    markPlannedEdit,
    markPlannedMove,
    previewLineIdForPath,
    primeWithCache,
    resetPreview,
    setObservedTopLevel,
    applyComplete as applyPreviewComplete,
} from "../state/importPreviewState";
import { setFocusLineId } from "../state/codeViewState";
import { importableSourcePath } from "../state/importablePaths";
import type { ImportDiffSink } from "../../importer/diffSink";
import { readKnowledge } from "../../knowledge/cache";
import { gmcOnImportStart, playImportSuccessSound } from "../../importer/sideEffects";
import { setImportRunning } from "../../importer/runtimeState";
import {
    beginTraceRun,
    endTraceRun,
    setTraceImportable,
    traceEvent,
} from "../../importer/traceLog";

export const CAPTURE_TYPES: CaptureType[] = ["FUNCTION", "MENU"];

function findImportableByKey(
    parsed: ParseResult<Importable[]>,
    key: string
): Importable | null {
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        if (trustPlanKey(imp.type, importableIdentity(imp)) === key) return imp;
    }
    return null;
}

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
    setKnowledgeRows(buildKnowledgeStatusRows(uuid, all));
}

function makeDiffSink(sourcePath: string, importable: Importable): ImportDiffSink {
    const key = diffKey(sourcePath);
    clearDiff(key);
    resetPreview(sourcePath);
    // Trace tagging: subsequent trace events belong to this importable
    // until the next setTraceImportable call (or run end).
    const importableId = `${importable.type}:${importableIdentity(importable)}`;
    setTraceImportable(importableId, {
        type: importable.type,
        identity: importableIdentity(importable),
        sourcePath,
    });
    // Prime the preview from the HTSW knowledge cache so the user sees
    // SOMETHING immediately while the importer's first read packet is
    // still in flight. Best-effort: missing UUID or missing cache entry
    // both fall through to an empty model.
    const uuid = getHousingUuid();
    let cachedImportable: Importable | null = null;
    if (uuid !== null) {
        const cache = readKnowledge(uuid, importable.type, importableIdentity(importable));
        cachedImportable = cache === null ? null : cache.importable;
        primeWithCache(sourcePath, cachedImportable);
    } else {
        primeWithCache(sourcePath, null);
    }
    traceEvent("importable-prime", {
        sourcePath,
        cacheHit: cachedImportable !== null,
        cachedImportable,
        desired: importable,
    });
    return {
        phase: (label) => setDiffPhase(key, label),
        summary: (summary) => setDiffSummary(key, summary),
        planOp: (path, kind, label, detail) =>
            setPlannedOp(key, path, kind, label, detail),
        deleteOp: (idx, label, detail) => addDeleteOp(key, idx, label, detail),
        markMatch: (path) => setDiffState(key, path, "match"),
        beginOp: (path, kind, label) => {
            setDiffPhase(key, label);
            setCurrent(key, path, label);
            setPlannedOp(key, path, kind, label, "");
            // Drive Spotify-lyrics-style auto-scroll. Pending-add lines
            // carry an `__add::` prefix on their id; previewLineIdForPath
            // returns the id that's actually present in the model so the
            // auto-follow lookup hits.
            setFocusLineId(sourcePath, previewLineIdForPath(sourcePath, path));
        },
        completeOp: (path, state) => {
            setDiffState(key, path, state);
            markCompleted(key, path);
            // Park the cursor on the op that just finished. Two reasons:
            // 1) avoids a flicker between ops (clearing → re-setting on
            //    next beginOp would briefly drop ▶ and the tint).
            // 2) after a nested CONDITIONAL's inner ops finish (which
            //    leave currentPath on the LAST inner action), the outer
            //    completeOp here pulls the cursor back up to the outer
            //    action's path — so when the step-gate pauses before the
            //    next outer op the user sees the cursor on the correct
            //    just-completed conditional, not stale on its last child.
            setCurrent(key, path, "");
            setFocusLineId(sourcePath, previewLineIdForPath(sourcePath, path));
        },
        end: () => {
            setCurrent(key, null, "");
            setFocusLineId(sourcePath, null);
            refreshKnowledgeRows();
        },
        setObservedSnapshot: (actions) => {
            setObservedTopLevel(sourcePath, actions);
        },
        setReading: (path, label) => {
            // Same wiring as beginOp, minus the planned-state side
            // effect — we don't want hydration to paint diff colors on
            // lines, just show the cursor and auto-scroll to it.
            setCurrent(key, path, label);
            setFocusLineId(sourcePath, previewLineIdForPath(sourcePath, path));
        },
        clearReading: () => {
            setCurrent(key, null, "");
        },
        planAdd: (path, desired, toIndex) => {
            markPlannedAdd(sourcePath, path, desired, toIndex);
        },
        planEdit: (path, observed, desired) => {
            markPlannedEdit(sourcePath, path, observed, desired);
        },
        planDelete: (path) => {
            markPlannedDelete(sourcePath, path);
        },
        planMove: (path, fromIndex, toIndex) => {
            markPlannedMove(sourcePath, path, fromIndex, toIndex);
        },
        applyDone: (path, finalState, kind) => {
            applyPreviewComplete(sourcePath, path, finalState, kind);
        },
        finalizeSource: (actions) => {
            finalizeFromSource(sourcePath, actions);
        },
        markActionHeadApplied: (path) => {
            markHeadApplied(sourcePath, path);
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

    // Auto-switch to creative — housing edits require it. Fires AFTER
    // the empty-queue early-return so we don't /gmc for a no-op invocation.
    gmcOnImportStart();

    // Open a trace run if `/htsw trace on` is active. The path here is
    // the planned write location; the file is actually written in the
    // finally block below. No-op when tracing is off.
    const tracePath = beginTraceRun({
        queueSize: total,
        sourcePath: batches.length === 1 ? batches[0].sourcePath : undefined,
        trustMode,
    });

    // Concatenate every batch's ordered importables for the run-row
    // tracking; the per-row UI only needs the flat list, not the
    // per-batch grouping.
    const allOrdered: Importable[] = [];
    for (const b of batches) for (const imp of b.importables) allOrdered.push(imp);
    beginImportRun(allOrdered);

    setImportProgress({
        weightCompleted: 0,
        weightTotal: 1,
        weightCurrent: 0,
        currentKey: "",
        currentType: null,
        currentIdentity: "starting",
        orderIndex: -1,
        rowStatus: null,
        currentLabel: "starting…",
        phase: "starting",
        phaseLabel: "starting import",
        unitCompleted: 0,
        unitTotal: 0,
        estimatedCompleted: 0,
        estimatedTotal: 1,
        etaConfidence: "rough",
        completed: 0,
        total,
        failed: 0,
        inFlight: true,
    });

    setImportRunning(true);
    TaskManager.run(async (ctx) => {
        const startedAt = Date.now();
        let success = false;
        // Hoisted out of try so the `finally` can pass them to
        // endTraceRun's summary even if the loop throws/cancels.
        let totalImported = 0;
        let totalSkipped = 0;
        let totalFailed = 0;
        let cancelled = false;
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
                const selection: ImportSelection = {
                    importables: batch.importables,
                    trustMode,
                    housingUuid,
                    sourcePath: batch.sourcePath,
                    onProgress: (p) => {
                        applyImportProgress(p);
                        updateImportRunFromProgress(p);
                        if (p.currentKey.length === 0) {
                            setCurrentImportingPath(null);
                            return;
                        }
                        const imp = findImportableByKey(batch.parsed, p.currentKey);
                        const path =
                            imp === null
                                ? null
                                : (importableSourcePath(imp, batch.parsed) ?? null);
                        setCurrentImportingPath(path);
                    },
                    diffSinkForImportable: (imp, path) =>
                        path === null ? null : makeDiffSink(path, imp),
                };
                const result = await importSelectedImportables(ctx, selection);
                totalImported += result.imported;
                totalSkipped += result.skippedTrusted;
                totalFailed += result.failed;
            }
            const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            ctx.displayMessage(
                `&7[import] done · imported ${totalImported}, skipped ${totalSkipped}, failed ${totalFailed}, ${elapsed}s`
            );
            success = (totalFailed === 0);
            // Only clear the queue when this run came from the queue. An
            // ad-hoc "Import selected" run leaves the queue alone since it
            // was never the source of the work.
            if (explicit === undefined) clearQueue();
        } catch (err) {
            // Detect TaskManager cancellation so the trace summary can
            // distinguish user-cancel from a genuine import failure.
            // Re-throw to keep the existing .catch() chat output intact.
            const message = err instanceof Error ? err.message : String(err);
            if (message.indexOf("cancelled") >= 0 || message.indexOf("Cancelled") >= 0) {
                cancelled = true;
            }
            throw err;
        } finally {
            setImportProgress(null);
            setCurrentImportingPath(null);
            clearImportRun();
            refreshKnowledgeRows();
            // Clear the importer's run flag BEFORE the chime fires so the
            // soundPlay cancel hook in `sideEffects` no longer swallows it.
            setImportRunning(false);
            // Untag the active importable BEFORE writing the trace so
            // the run-end event isn't attributed to a specific one.
            setTraceImportable(null);
            const writtenTracePath = endTraceRun({
                imported: totalImported,
                skipped: totalSkipped,
                failed: totalFailed,
                cancelled,
            });
            if (writtenTracePath !== null) {
                ChatLib.chat(`&7[trace] wrote ${writtenTracePath}`);
            } else if (tracePath !== null) {
                // Trace was enabled but the write failed — note it.
                ChatLib.chat(`&c[trace] failed to write trace file (was planned at ${tracePath})`);
            }
        }
        // After finally: import progress is cleared, so the soundPlay
        // cancel hook no longer swallows sounds and this chime can play.
        // Cancellation throws BEFORE this line — no chime on cancel.
        if (success) playImportSuccessSound();
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Import failed: ${err}`);
    });
}

// ── Capture flow (unchanged from prior version) ──────────────────────────

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
