import type { ImportableItem } from "htsw/types";

import {
    restorePlayerInventory,
    snapshotPlayerInventory,
    type PlayerInventorySnapshot,
} from "../../housingSync/items/playerInventory";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { isTaskCancelled } from "../../tasks/manager";
import TaskContext from "../../tasks/context";
import { exportCapturedItems } from "../items/exportCapturedItems";
import {
    htslTargetsForNpcExport,
    npcExportReferencesExist,
    type NpcExportEntry,
} from "../../project/paths";
import type { ReadOutput, ReadResult } from "../export/reader";
import { exportNpcWithSharedState } from "./export";
import { readImportableCache } from "../../importCache/cache";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import { npcPosIdentity } from "../identity";
import { createExportItemCaptureRegistry } from "../export/projectDestination";
import {
    createNpcLookupCache,
    findNpcByPos,
    listAllNpcs,
    npcLabel,
    type NpcListEntry,
} from "./listNpcs";
import { refreshExportedItemDependencies } from "../export/exporter";
import { capturedItemFieldContent } from "../../housingSync/items/fieldContent";

export type ExportAllNpcsOptions = {
    importJsonPath: string;
    newExportTargetImportJson?: string;
    rootDir: string;
    entries?: readonly NpcExportEntry[];
    progress?: ExportProgressSink;
    projectItems?: readonly ImportableItem[];
    skipExisting?: boolean;
    output: ReadOutput;
    quiet?: boolean;
    onItemFailure?: (error: unknown, identity: string, rowIndex: number) => void;
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
    skipExisting: boolean | undefined,
    showProgressMessages: boolean
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
    if (skipped > 0 && showProgressMessages) {
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
    const readOnly = options.output.kind !== "project";
    const cacheOnly = options.output.kind === "cache";
    const quiet = options.quiet === true;
    const showProgressMessages = !quiet && options.progress === undefined;
    const verb = readOnly ? "Reading" : "Exporting";
    const lockHousingUuid =
        options.output.kind === "project"
            ? await getCurrentHousingUuid(ctx)
            : options.output.housingUuid;

    const inventorySnapshot: PlayerInventorySnapshot = snapshotPlayerInventory();
    const itemCaptures = createExportItemCaptureRegistry(
        importJsonPath,
        lockHousingUuid,
        options.projectItems
    );
    const npcLookup = createNpcLookupCache();

    const liveEntries = await listAllNpcs(ctx, npcLookup);
    const requested =
        options.entries !== undefined
            ? options.entries
            : liveEntries.map(exportEntryForLiveNpc);
    const exportEntries = filterNpcEntries(
        ctx,
        importJsonPath,
        requested,
        readOnly ? false : options.skipExisting,
        showProgressMessages
    );
    if (exportEntries.length === 0) {
        if (showProgressMessages) {
            ctx.displayMessage(`&7No NPCs to ${readOnly ? "read" : "export"}.`);
        }
        try {
            await restorePlayerInventory(ctx, inventorySnapshot);
        } catch (error) {
            ctx.displayMessage(`&7[export] &eInventory restore failed: ${String(error)}`);
        }
        return { total: 0, succeeded: 0, failed: 0 };
    }

    if (showProgressMessages) {
        ctx.displayMessage(
            `&a${verb} ${exportEntries.length} NPC${exportEntries.length === 1 ? "" : "s"}...`
        );
    }
    const labels = exportEntries.map((entry) => npcLabel(entry));
    options.progress?.start(labels);

    let succeeded = 0;
    let failed = 0;
    const completedNames = new Set<string>();
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
                if (showProgressMessages) {
                    ctx.displayMessage(
                        `&7[${i + 1}/${exportEntries.length}] &f${verb} NPC '${label}'`
                    );
                }
                const itemProgress = sink?.itemProgress?.bind(sink);

                await exportNpcWithSharedState(
                    ctx,
                    {
                        entry: liveEntry,
                        importJsonPath,
                        declaringJsonPath: target.importJsonPath,
                        leftClickTarget: target.leftClick,
                        rightClickTarget: target.rightClick,
                        rootDir,
                        output: options.output,
                        quiet,
                        showProgressMessages,
                        onReadProgress:
                            itemProgress === undefined
                                ? undefined
                                : (payload) => itemProgress(i, payload),
                        events: sink?.events,
                        eventsForList: sink?.eventsForList,
                    },
                    { itemCaptures, inventorySnapshot, npcLookup }
                );
                if (!readOnly) {
                    const identity = npcPosIdentity(liveEntry.pos);
                    const cached = readImportableCache(lockHousingUuid, "NPC", identity);
                    if (cached !== null) {
                        upsertHouseLockImportable(
                            importJsonPath,
                            lockHousingUuid,
                            {
                                importable: cached.importable,
                                itemContent: capturedItemFieldContent(
                                    cached.importable,
                                    itemCaptures.entries()
                                ),
                            }
                        );
                    }
                }
                completedNames.add(npcPosIdentity(liveEntry.pos));
                succeeded++;
                sink?.itemFinished?.(i);
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                options.onItemFailure?.(error, npcPosIdentity(requestedEntry.pos), i);
                failed++;
                sink?.itemFailed?.(i, String(error));
                if (!quiet) {
                    ctx.displayMessage(
                        `&c[export-all] failed on NPC '${label}': ${String(error)}`
                    );
                }
            }
        }
    } finally {
        options.progress?.done();
        try {
            if (!readOnly) {
                await exportCapturedItems(
                    ctx,
                    itemCaptures,
                    rootDir,
                    importJsonPath,
                    lockHousingUuid,
                    options.newExportTargetImportJson,
                    showProgressMessages
                );
            }
            if (options.output.kind !== "memory") {
                refreshExportedItemDependencies(
                    ctx,
                    importJsonPath,
                    lockHousingUuid,
                    "NPC",
                    completedNames,
                    new Set(
                        cacheOnly
                            ? itemCaptures.matchedItemNames()
                            : itemCaptures.capturedItemNames()
                    ),
                    !readOnly
                );
            }
        } finally {
            try {
                await restorePlayerInventory(ctx, inventorySnapshot);
            } catch (error) {
                ctx.displayMessage(
                    `&7[export] &eInventory restore failed (export results still written): ${String(error)}`
                );
            }
        }
    }

    const plural = exportEntries.length === 1 ? "" : "s";
    const failedNote = failed > 0 ? ` &c[${failed} failed]` : "";
    if (readOnly) {
        if (showProgressMessages) {
            ctx.displayMessage(
                `&aRead ${succeeded} of ${exportEntries.length} NPC${plural}${failedNote}`
            );
        }
        return { total: exportEntries.length, succeeded, failed };
    }
    if (showProgressMessages) {
        const itemCounts = itemCaptures.counts();
        ctx.displayMessage(
            `&aExported ${succeeded} of ${exportEntries.length} NPC${plural} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failedNote}`
        );
        ctx.displayMessage(`&7  -> ${importJsonPath}`);
    }

    return { total: exportEntries.length, succeeded, failed };
}
