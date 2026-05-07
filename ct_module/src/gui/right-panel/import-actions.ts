/// <reference types="../../../CTAutocomplete" />

import {
    applyImportProgress,
    beginImportRun,
    clearImportRun,
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
import { encodeFilesystemComponent } from "../../utils/filesystem";
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
import { importableSourcePath } from "../state/importablePaths";
import type { ImportDiffSink } from "../../importer/diffSink";

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

function makeDiffSink(sourcePath: string): ImportDiffSink {
    const key = diffKey(sourcePath);
    clearDiff(key);
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
        },
        completeOp: (path, state) => {
            setDiffState(key, path, state);
            markCompleted(key, path);
            setCurrent(key, null, "");
        },
        end: () => {
            setCurrent(key, null, "");
            refreshKnowledgeRows();
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

    TaskManager.run(async (ctx) => {
        const startedAt = Date.now();
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
                    diffSinkForImportable: (_imp, path) =>
                        path === null ? null : makeDiffSink(path),
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
        } finally {
            setImportProgress(null);
            setCurrentImportingPath(null);
            clearImportRun();
            refreshKnowledgeRows();
        }
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
        const importJsonPath = getImportJsonPath();
        if (importJsonPath.trim() === "") {
            ctx.displayMessage("&c[htsw] No import.json loaded — load one first");
            return;
        }
        const dir = importJsonDir(importJsonPath);
        if (result.type === "FUNCTION") {
            const filename = `${encodeFilesystemComponent(result.name, { escapeDots: false })}.htsl`;
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
