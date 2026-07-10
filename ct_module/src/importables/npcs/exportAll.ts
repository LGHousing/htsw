import type { ImportableItem } from "htsw/types";

import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { isTaskCancelled } from "../../tasks/manager";
import TaskContext from "../../tasks/context";
import { writeCapturedItems } from "../items/writeCapturedItems";
import {
    htslTargetsForNpcExport,
    npcExportReferencesExist,
    type NpcExportEntry,
} from "../../project/paths";
import type { ReadResult } from "../read";
import { exportNpcWithSharedState } from "./export";
import { readImportableCache } from "../../importCache/cache";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import { npcPosIdentity } from "../identity";
import {
    createNpcLookupCache,
    findNpcByPos,
    listAllNpcs,
    npcLabel,
    type NpcListEntry,
} from "./listNpcs";

export type ExportAllNpcsOptions = {
    importJsonPath: string;
    newExportTargetImportJson?: string;
    rootDir: string;
    entries?: readonly NpcExportEntry[];
    progress?: ExportProgressSink;
    projectItems?: readonly ImportableItem[];
    skipExisting?: boolean;
    // Read-only (deep read): cache each NPC, write no files.
    readOnly?: { housingUuid: string };
};

export async function exportAllNpcs(
    ctx: TaskContext,
    options: ExportAllNpcsOptions
): Promise<ReadResult> {
    return exportAllNpcsInner(ctx, options);
}

function exportEntryForLiveNpc(entry: NpcListEntry): NpcExportEntry {
    return {
        name: entry.name,
        pos: entry.pos,
    };
}

function filterNpcEntries(
    ctx: TaskContext,
    importJsonPath: string,
    entries: readonly NpcExportEntry[],
    skipExisting: boolean | undefined
): NpcExportEntry[] {
    if (skipExisting !== true) return entries.slice();

    const out: NpcExportEntry[] = [];
    let skipped = 0;
    for (let i = 0; i < entries.length; i++) {
        if (npcExportReferencesExist(importJsonPath, entries[i])) {
            skipped++;
        } else {
            out.push(entries[i]);
        }
    }
    if (skipped > 0) {
        ctx.displayMessage(
            `&aResume detected ${skipped} already-exported NPC${skipped === 1 ? "" : "s"}; exporting ${out.length} remaining.`
        );
    }
    return out;
}

async function exportAllNpcsInner(
    ctx: TaskContext,
    options: ExportAllNpcsOptions
): Promise<ReadResult> {
    const { importJsonPath, rootDir } = options;
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";
    const lockHousingUuid =
        options.readOnly?.housingUuid ?? (await getCurrentHousingUuid(ctx));

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const npcLookup = createNpcLookupCache();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    const liveEntries = await listAllNpcs(ctx, npcLookup);
    const requested =
        options.entries !== undefined
            ? options.entries
            : liveEntries.map(exportEntryForLiveNpc);
    const exportEntries = filterNpcEntries(
        ctx,
        importJsonPath,
        requested,
        readOnly ? false : options.skipExisting
    );
    if (exportEntries.length === 0) {
        ctx.displayMessage(`&7No NPCs to ${readOnly ? "read" : "export"}.`);
        try {
            await restoreInventoryToSnapshot(ctx, inventorySnapshot);
        } catch (error) {
            ctx.displayMessage(
                `&7[export] &eInventory restore failed: ${error}`
            );
        }
        return { total: 0, succeeded: 0, failed: 0 };
    }

    ctx.displayMessage(
        `&a${verb} ${exportEntries.length} NPC${exportEntries.length === 1 ? "" : "s"}...`
    );
    const labels = exportEntries.map((entry) => npcLabel(entry));
    options.progress?.start(labels);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < exportEntries.length; i++) {
            ctx.checkCancelled();
            const requestedEntry = exportEntries[i];
            const sink = options.progress;
            let label = npcLabel(requestedEntry);
            try {
                const liveEntry = findNpcByPos(liveEntries, requestedEntry.pos);
                if (liveEntry === null) {
                    throw new Error(
                        `No NPC exists at ${requestedEntry.pos.x},${requestedEntry.pos.y},${requestedEntry.pos.z}.`
                    );
                }

                const targetEntry = exportEntryForLiveNpc(liveEntry);
                const target = htslTargetsForNpcExport(
                    importJsonPath,
                    targetEntry,
                    options.newExportTargetImportJson
                );
                label = npcLabel(liveEntry);
                options.progress?.item(i, label);
                ctx.displayMessage(
                    `&7[${i + 1}/${exportEntries.length}] &f${verb} NPC '${label}'`
                );

                await exportNpcWithSharedState(
                    ctx,
                    {
                        entry: liveEntry,
                        importJsonPath,
                        declaringJsonPath: target.importJsonPath,
                        leftClickTarget: target.leftClick,
                        rightClickTarget: target.rightClick,
                        rootDir,
                        readOnly: options.readOnly,
                        onReadProgress:
                            sink?.itemProgress === undefined
                                ? undefined
                                : (payload) => sink.itemProgress!(i, payload),
                    },
                    { itemCaptures, inventorySnapshot, npcLookup }
                );
                const identity = npcPosIdentity(liveEntry.pos);
                const cached = readImportableCache(lockHousingUuid, "NPC", identity);
                if (cached !== null) {
                    upsertHouseLockImportable(
                        importJsonPath,
                        lockHousingUuid,
                        cached.importable
                    );
                }
                succeeded++;
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                sink?.itemFailed?.(i, String(error));
                ctx.displayMessage(
                    `&c[export-all] failed on NPC '${label}': ${error}`
                );
            }
        }
    } finally {
        options.progress?.done();
        try {
            if (!readOnly) {
                await writeCapturedItems(
                    ctx,
                    itemCaptures,
                    rootDir,
                    importJsonPath,
                    options.newExportTargetImportJson
                );
            }
        } finally {
            try {
                await restoreInventoryToSnapshot(ctx, inventorySnapshot);
            } catch (error) {
                ctx.displayMessage(
                    `&7[export] &eInventory restore failed (export results still written): ${error}`
                );
            }
        }
    }

    const plural = exportEntries.length === 1 ? "" : "s";
    const failedNote = failed > 0 ? ` &c[${failed} failed]` : "";
    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${succeeded} of ${exportEntries.length} NPC${plural}${failedNote}`
        );
        return { total: exportEntries.length, succeeded, failed };
    }
    const itemCounts = itemCaptures.counts();
    ctx.displayMessage(
        `&aExported ${succeeded} of ${exportEntries.length} NPC${plural} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failedNote}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: exportEntries.length, succeeded, failed };
}
