/// <reference types="../../../../CTAutocomplete" />

import {
    createImportRows,
    createImportProgress,
    getExportImportJsonPath,
    getHousingUuid,
    getImportJsonPath,
    isCurrentHouseTrusted,
    setCurrentImportingPath,
    setHousingUuid,
    setImportProgress,
    setKnowledgeRows,
} from "../../state";
import {
    clearQueue,
    getQueue,
    type QueueItem,
} from "../../state/queue";
import { forEachCachedParse, getParseAt, parseImportJsonAt } from "../../state/parses";
import { buildCacheStatusRows } from "../../../importCache/status";
import {
    importSelectedImportables,
    orderImportablesForImportSession,
    type ImportSelection,
} from "../../../importables/importSession";
import { exportImportable } from "../../../importables/exports";
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
import { htslFilenameForFunctionExport } from "../../../exporter/paths";
import {
    clearDiff,
    addDeleteOp,
    diffKey,
    markCompleted,
    markDeleteCompleted,
    setCurrent,
    setDiffState,
    setDiffPhase,
    setDiffSummary,
    setPlannedOp,
} from "../../state/diff";
import { importableSourcePath } from "../../state/importablePaths";
import type {
    ActionDiffOperationPayload,
    ImportPreviewEventHandler,
    ImportPreviewEvent,
} from "../../../importer/importPreviewEvents";
import { importProgressKey } from "../../../importer/progress/keys";
import { setImportRunning } from "../../../importer/runtimeState";
import { gmcOnImportStart, playImportSuccessSound } from "../../../importer/sideEffects";
import { resetStepGate } from "../../../importer/stepGate";
import {
    applyComplete,
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
} from "../../state/importPreviewState";
import { setFocusLineId } from "../../state/codeViewState";
import { readImportableCache } from "../../../importCache/cache";
import { ACTION_MAPPINGS } from "../../../importer/fields/actionMappings";

export const CAPTURE_TYPES: CaptureType[] = ["FUNCTION", "MENU"];

function findImportableByKey(
    parsed: ParseResult<Importable[]>,
    key: string,
    sourcePath: string
): Importable | null {
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        if (
            importProgressKey(imp.type, importableIdentity(imp), sourcePath) === key
        ) {
            return imp;
        }
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
    setKnowledgeRows(buildCacheStatusRows(uuid, all));
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
    if (event.op === "move" && event.toIndex !== undefined) {
        return `${operationVerb(event.op)} ${name} -> #${event.toIndex + 1}`;
    }
    return `${operationVerb(event.op)} ${name}`;
}

function operationDetail(event: ActionDiffOperationPayload): string {
    if (event.op === "add") return "add source action";
    if (event.op === "move") {
        if (event.fromIndex !== undefined && event.toIndex !== undefined) {
            return `#${event.fromIndex + 1} -> #${event.toIndex + 1}`;
        }
        return "move source action";
    }
    if (event.op === "edit") {
        const fields = event.fieldsChanged ?? [];
        return fields.length === 0 ? "fields changed" : fields.join(", ");
    }
    return "delete source action";
}

function readingLabel(actionType: Action["type"] | null): string {
    return `Reading nested ${displayNameForActionType(actionType)}`;
}

function makeImportPreviewHandler(
    sourcePath: string,
    importable: Importable,
    housingUuid: string | null
): ImportPreviewEventHandler {
    const key = diffKey(sourcePath);
    clearDiff(key);
    resetPreview(sourcePath);
    const cached = housingUuid === null
        ? null
        : readImportableCache(housingUuid, importable.type, importableIdentity(importable));
    primeWithCache(sourcePath, cached === null ? null : cached.importable);
    // Mapped type: one handler per event kind, parameter narrowed to the
    // specific event shape. TS enforces exhaustiveness on the handlers
    // object — adding a new event kind here surfaces as a typecheck error
    // until the corresponding handler is filled in.
    type Handlers = {
        [E in ImportPreviewEvent as E["kind"]]: (event: E) => void;
    };
    const handlers: Handlers = {
        progress: () => {},
        readStarted: (e) => setDiffPhase(key, `Reading ${e.listPath}`),
        readCompleted: (e) => setDiffPhase(key, `${e.observedCount} actions read`),
        hydrationStarted: (e) => setDiffPhase(key, readingLabel(e.actionType)),
        hydrationCompleted: () => {},
        diffComputed: (e) => {
            setDiffSummary(key, e.summary);
            setDiffPhase(key, "Diff computed");
        },
        operationPlanned: (e) =>
            setPlannedOp(key, e.path, e.op, operationLabel(e), operationDetail(e)),
        extraActionPlanned: (e) =>
            addDeleteOp(
                key,
                e.observedEntryId,
                e.index,
                `Delete extra ${displayNameForActionType(e.actionType)}`,
                "delete unneeded action"
            ),
        match: (e) => setDiffState(key, e.path, "match"),
        operationStarted: (e) => {
            setDiffPhase(key, operationLabel(e));
            setCurrent(key, e.path, operationLabel(e));
            setPlannedOp(key, e.path, e.op, operationLabel(e), "");
            setFocusLineId(sourcePath, previewLineIdForPath(sourcePath, e.path));
        },
        operationCompleted: (e) => {
            setDiffState(key, e.path, e.finalState);
            markCompleted(key, e.path);
            setCurrent(key, null, "");
        },
        extraActionDeleted: (e) => markDeleteCompleted(key, e.observedEntryId),
        syncCompleted: () => {
            setCurrent(key, null, "");
            setFocusLineId(sourcePath, null);
            refreshKnowledgeRows();
        },
        observedSnapshot: (e) => setObservedTopLevel(sourcePath, e.actions),
        reading: (e) => {
            setCurrent(key, e.path, readingLabel(e.actionType));
            setFocusLineId(sourcePath, previewLineIdForPath(sourcePath, e.path));
        },
        clearReading: () => {
            setCurrent(key, null, "");
            setFocusLineId(sourcePath, null);
        },
        blockActionHeaderApplied: (e) => markHeadApplied(sourcePath, e.path),
        plannedAdd: (e) => markPlannedAdd(sourcePath, e.path, e.desired, e.toIndex),
        plannedEdit: (e) =>
            markPlannedEdit(sourcePath, e.path, e.observed, e.desired),
        plannedDelete: (e) => markPlannedDelete(sourcePath, e.path),
        plannedMove: (e) =>
            markPlannedMove(sourcePath, e.path, e.fromIndex, e.toIndex),
        applyDone: (e) => applyComplete(sourcePath, e.path, e.finalState, e.op),
        finalizeSource: (e) => finalizeFromSource(sourcePath, e.actions),
    };
    return {
        emit: (event) => {
            // Cast: TS sees `handlers[event.kind]` as the union of all handler
            // signatures (so its parameter is the intersection — `never`).
            // We know the runtime kind matches the handler's narrowed type.
            (handlers[event.kind] as (e: typeof event) => void)(event);
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
        totalImportables: total,
        totalUnits: 1,
        rows,
    }));

    setImportRunning(true);
    resetStepGate();
    gmcOnImportStart();

    TaskManager.run(async (ctx) => {
        const startedAt = Date.now();
        let importSucceeded = false;
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
            let totalImported = 0;
            let totalSkipped = 0;
            let totalFailed = 0;
            for (const batch of batches) {
                const selection: ImportSelection = {
                    importables: batch.importables,
                    trustMode,
                    housingUuid,
                    sourcePath: batch.sourcePath,
                    onProgress: (p) => {
                        setImportProgress(p);
                        if (p.current === null) {
                            setCurrentImportingPath(null);
                            return;
                        }
                        const imp = findImportableByKey(
                            batch.parsed,
                            p.current.key,
                            batch.sourcePath
                        );
                        const path =
                            imp === null
                                ? null
                                : (importableSourcePath(imp, batch.parsed) ?? null);
                        setCurrentImportingPath(path);
                    },
                    previewHandlerForImportable: (imp, path) =>
                        path === null ? null : makeImportPreviewHandler(path, imp, housingUuid),
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
            // Only clear the queue when this run came from the queue. An
            // ad-hoc "Import selected" run leaves the queue alone since it
            // was never the source of the work.
            if (explicit === undefined) clearQueue();
            importSucceeded = totalFailed === 0;
        } finally {
            setImportProgress(null);
            setCurrentImportingPath(null);
            refreshKnowledgeRows();
            setImportRunning(false);
            if (importSucceeded) playImportSuccessSound();
        }
    }).catch((err: unknown) => {
        setImportRunning(false);
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
