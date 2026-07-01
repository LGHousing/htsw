import type { Action, ImportableItem, ImportableNpc, Pos } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { tryWriteImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import {
    htslTargetsForNpcExport,
    type HtslExportTarget,
    type NpcExportEntry,
} from "../../project/paths";
import TaskContext from "../../tasks/context";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    openNpcLeftClickActions,
    openNpcRightClickActions,
    readLeftClickRedirect,
} from "./shared";
import {
    createNpcLookupCache,
    npcLabel,
    openNpcEditorForPos,
    type NpcListEntry,
    type NpcLookupCache,
} from "./listNpcs";

export type ExportNpcOptions = {
    name: string;
    pos: Pos;
    importJsonPath: string;
    rootDir: string;
    onReadProgress?: ProgressHandler;
    projectItems?: readonly ImportableItem[];
};

export type ExportNpcWithSharedStateOptions = {
    entry: NpcListEntry;
    importJsonPath: string;
    declaringJsonPath: string;
    leftClickTarget: HtslExportTarget;
    rightClickTarget: HtslExportTarget;
    rootDir: string;
    onReadProgress?: ProgressHandler;
};

export type SharedNpcExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
    npcLookup: NpcLookupCache;
};

async function readNpcActionList(
    ctx: TaskContext,
    entry: NpcListEntry,
    slotKind: "leftClickActions" | "rightClickActions",
    itemCaptures: ItemCaptureRegistry,
    npcLookup: NpcLookupCache,
    onReadProgress?: ProgressHandler
): Promise<Action[]> {
    if (slotKind === "leftClickActions") {
        await openNpcLeftClickActions(ctx, entry, npcLookup);
    } else {
        await openNpcRightClickActions(ctx, entry, npcLookup);
    }

    return await readOpenNpcActionList(
        ctx,
        itemCaptures,
        onReadProgress
    );
}

async function readOpenNpcActionList(
    ctx: TaskContext,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<Action[]> {
    const observed = await readActionList(ctx, { kind: "deep" }, {
        itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    return observedSlotsToActions(observed);
}

function writeActionFile(
    ctx: TaskContext,
    target: HtslExportTarget,
    actions: readonly Action[]
): void {
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }
    ensureParentDirs(target.htslPath);
    FileLib.write(target.htslPath, source, true);
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

async function findNpcEntry(
    ctx: TaskContext,
    pos: Pos,
    cache: NpcLookupCache
): Promise<NpcListEntry> {
    return await openNpcEditorForPos(ctx, pos, cache);
}

export async function exportNpcWithSharedState(
    ctx: TaskContext,
    options: ExportNpcWithSharedStateOptions,
    shared: SharedNpcExportState
): Promise<void> {
    await openNpcEditorForPos(ctx, options.entry.pos, shared.npcLookup);
    const leftSlot = ctx.getMenuItemSlot("Left Click Actions");
    const rightSlot = ctx.getMenuItemSlot("Right Click Actions");
    const leftShallowHasActions = shallowActionListHasActions(leftSlot);
    const rightShallowHasActions = shallowActionListHasActions(rightSlot);

    let leftActions: Action[] | undefined;
    let rightActions: Action[] | undefined;

    leftSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const leftClickRedirect = readLeftClickRedirect(ctx);

    if (leftShallowHasActions) {
        const actions = await readOpenNpcActionList(
            ctx,
            shared.itemCaptures,
            options.onReadProgress
        );
        if (actions.length > 0) {
            leftActions = actions;
        }
    }
    ctx.checkCancelled();

    if (rightShallowHasActions) {
        const actions = await readNpcActionList(
            ctx,
            options.entry,
            "rightClickActions",
            shared.itemCaptures,
            shared.npcLookup,
            options.onReadProgress
        );
        if (actions.length > 0) {
            rightActions = actions;
        }
    }

    if (leftActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.leftClickTarget, leftActions);
    }
    if (rightActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.rightClickTarget, rightActions);
    }

    const importable: ImportableNpc = {
        type: "NPC",
        name: options.entry.name,
        pos: options.entry.pos,
        ...(leftActions !== undefined ? { leftClickActions: leftActions } : {}),
        ...(rightActions !== undefined ? { rightClickActions: rightActions } : {}),
        leftClickRedirect,
    };

    upsertImportableEntry(options.declaringJsonPath, "npcs", {
        name: options.entry.name,
        pos: options.entry.pos,
        ...(leftActions !== undefined
            ? { leftClickActions: options.leftClickTarget.htslReference }
            : {}),
        ...(rightActions !== undefined
            ? { rightClickActions: options.rightClickTarget.htslReference }
            : {}),
        leftClickRedirect,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    const actionCount = (leftActions?.length ?? 0) + (rightActions?.length ?? 0);
    ctx.displayMessage(
        `&aExported NPC '${npcLabel(options.entry)}' (${actionCount} action${actionCount === 1 ? "" : "s"})`
    );
}

export async function exportNpc(
    ctx: TaskContext,
    options: ExportNpcOptions
): Promise<void> {
    return exportNpcInner(ctx, options);
}

async function exportNpcInner(
    ctx: TaskContext,
    options: ExportNpcOptions
): Promise<void> {
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const npcLookup = createNpcLookupCache();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    let exportError: unknown = null;
    try {
        const entry = await findNpcEntry(ctx, options.pos, npcLookup);
        const targetEntry: NpcExportEntry = {
            name: entry.name,
            pos: entry.pos,
        };
        const target = htslTargetsForNpcExport(options.importJsonPath, targetEntry);
        await exportNpcWithSharedState(ctx, {
            entry,
            importJsonPath: options.importJsonPath,
            declaringJsonPath: target.importJsonPath,
            leftClickTarget: target.leftClick,
            rightClickTarget: target.rightClick,
            rootDir: options.rootDir,
            onReadProgress: options.onReadProgress,
        }, { itemCaptures, inventorySnapshot, npcLookup });
    } catch (error) {
        exportError = error;
    }

    try {
        writeCapturedItems(ctx, itemCaptures, options.rootDir, options.importJsonPath);
        if (exportError === null) {
            const c = itemCaptures.counts();
            ctx.displayMessage(
                `&7[export] &fItems: ${c.matched} matched, ${c.fresh} new`
            );
            ctx.displayMessage(`&7  -> ${options.importJsonPath}`);
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

    if (exportError !== null) {
        throw exportError;
    }
}
