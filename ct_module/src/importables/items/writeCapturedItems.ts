import * as htsw from "htsw";
import type { Action } from "htsw/types";
import {
    type CapturedItem,
    holdCapturedItem,
    type ItemCaptureRegistry,
    portableItemSnbt,
} from "../../housingSync/itemCapture";
import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { snbtTargetForItemExport } from "../../project/paths";
import { itemEditorOpened } from "../waiters";

type ExportedClickActions = {
    left?: Action[];
    right?: Action[];
};

async function readOpenActionList(
    ctx: TaskContext,
    registry: ItemCaptureRegistry
): Promise<Action[]> {
    return readActionListFully(ctx, { itemCaptures: registry });
}

async function readClickActions(
    ctx: TaskContext,
    item: CapturedItem,
    registry: ItemCaptureRegistry
): Promise<ExportedClickActions> {
    await holdCapturedItem(ctx, item);
    await ctx.expectAfter(() => ctx.runCommand("/edit"), itemEditorOpened());
    ctx.getItemSlot("Edit Actions").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const leftHasActions = shallowActionListHasActions(
        ctx.getItemSlot("Left Click Actions")
    );
    const rightHasActions = shallowActionListHasActions(
        ctx.getItemSlot("Right Click Actions")
    );
    const result: ExportedClickActions = {};

    if (leftHasActions) {
        ctx.getItemSlot("Left Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const actions = await readOpenActionList(ctx, registry);
        if (actions.length > 0) result.left = actions;
        if (rightHasActions) await clickGoBack(ctx);
    }

    if (rightHasActions) {
        ctx.getItemSlot("Right Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const actions = await readOpenActionList(ctx, registry);
        if (actions.length > 0) result.right = actions;
    }

    return result;
}

function actionReference(snbtReference: string, side: "left" | "right"): string {
    return snbtReference.replace(/\.snbt$/i, `_${side}.htsl`);
}

function actionPath(snbtPath: string, side: "left" | "right"): string {
    return snbtPath.replace(/\.snbt$/i, `_${side}.htsl`);
}

function writeActions(ctx: TaskContext, path: string, actions: readonly Action[]): void {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diagnostic of printed.diagnostics) {
        ctx.displayMessage(`&7[export] &e${diagnostic.message}`);
    }
    ensureParentDirs(path);
    FileLib.write(path, printed.source, true);
    ctx.displayMessage(`&7  -> ${path}`);
}

export async function writeCapturedItems(
    ctx: TaskContext,
    registry: ItemCaptureRegistry,
    rootDir: string,
    importJsonPath: string,
    newExportTargetImportJson?: string
): Promise<number> {
    if (registry.newEntries().length === 0) return 0;

    const written = new Set<string>();

    while (true) {
        const item = registry.newEntries().find((entry) => !written.has(entry.name));
        if (item === undefined) break;
        written.add(item.name);
        const actions = await readClickActions(ctx, item, registry);
        const target = snbtTargetForItemExport(
            importJsonPath,
            rootDir,
            item.name,
            undefined,
            newExportTargetImportJson
        );
        ensureParentDirs(target.snbtPath);
        FileLib.write(target.snbtPath, portableItemSnbt(item.snbt), true);

        if (actions.left !== undefined) {
            writeActions(ctx, actionPath(target.snbtPath, "left"), actions.left);
        }
        if (actions.right !== undefined) {
            writeActions(ctx, actionPath(target.snbtPath, "right"), actions.right);
        }

        upsertImportableEntry(target.importJsonPath, "items", {
            name: item.name,
            nbt: target.snbtReference,
            ...(actions.left !== undefined
                ? { leftClickActions: actionReference(target.snbtReference, "left") }
                : {}),
            ...(actions.right !== undefined
                ? { rightClickActions: actionReference(target.snbtReference, "right") }
                : {}),
        });
        ctx.displayMessage(`&7  -> ${target.snbtPath}`);
    }

    return written.size;
}
