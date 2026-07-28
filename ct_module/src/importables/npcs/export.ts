import type { Action, ImportableNpc } from "htsw/types";
import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { ItemCaptureRegistry } from "../items/captureRegistry";
import type { PlayerInventorySnapshot } from "../../housingSync/items/playerInventory";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import type { HtslExportTarget } from "../../project/paths";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    openNpcLeftClickActions,
    openNpcRightClickActions,
    readLeftClickRedirect,
} from "./housing";
import {
    npcLabel,
    openNpcEditorForPos,
    type NpcListEntry,
    type NpcLookupCache,
} from "./listNpcs";
import type { ReadOutput } from "../export/reader";

export type ExportNpcWithSharedStateOptions = {
    entry: NpcListEntry;
    importJsonPath: string;
    declaringJsonPath: string;
    leftClickTarget: HtslExportTarget;
    rightClickTarget: HtslExportTarget;
    rootDir: string;
    onReadProgress?: ProgressHandler;
    events?: SyncEventHandler;
    output: ReadOutput;
    quiet?: boolean;
};

export type SharedNpcExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: PlayerInventorySnapshot;
    npcLookup: NpcLookupCache;
};

async function readNpcActionList(
    ctx: TaskContext,
    entry: NpcListEntry,
    slotKind: "leftClickActions" | "rightClickActions",
    itemCaptures: ItemCaptureRegistry,
    npcLookup: NpcLookupCache,
    onReadProgress?: ProgressHandler,
    events?: SyncEventHandler
): Promise<Action[]> {
    if (slotKind === "leftClickActions") {
        await openNpcLeftClickActions(ctx, entry, npcLookup);
    } else {
        await openNpcRightClickActions(ctx, entry, npcLookup);
    }

    return await readOpenNpcActionList(ctx, itemCaptures, onReadProgress, events);
}

async function readOpenNpcActionList(
    ctx: TaskContext,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler,
    events?: SyncEventHandler
): Promise<Action[]> {
    return readActionListFully(ctx, {
        itemReadMode: "export",
        itemCaptures,
        events,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
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
            options.onReadProgress,
            options.events
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
            options.onReadProgress,
            options.events
        );
        if (actions.length > 0) {
            rightActions = actions;
        }
    }

    const importable: ImportableNpc = {
        type: "NPC",
        name: options.entry.name,
        pos: options.entry.pos,
        ...(leftActions !== undefined ? { leftClickActions: leftActions } : {}),
        ...(rightActions !== undefined ? { rightClickActions: rightActions } : {}),
        leftClickRedirect,
    };
    const actionCount = (leftActions?.length ?? 0) + (rightActions?.length ?? 0);

    if (options.output.kind === "cache") {
        writeImportableCache(ctx, options.output.housingUuid, importable, "reader", true);
        if (options.quiet !== true) {
            ctx.displayMessage(
                `&aRead NPC '${npcLabel(options.entry)}' (${actionCount} action${actionCount === 1 ? "" : "s"})`
            );
        }
        return;
    }
    if (options.output.kind === "memory") {
        options.output.accept(importable);
        return;
    }

    if (leftActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.leftClickTarget, leftActions);
    }
    if (rightActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.rightClickTarget, rightActions);
    }

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

    ctx.displayMessage(
        `&aExported NPC '${npcLabel(options.entry)}' (${actionCount} action${actionCount === 1 ? "" : "s"})`
    );
}
