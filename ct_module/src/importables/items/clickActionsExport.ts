import * as htsw from "htsw";
import type { Action } from "htsw/types";

import {
    type CapturedItem,
    holdCapturedItem,
    type ItemCaptureRegistry,
} from "../../housingSync/itemCapture";
import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { itemEditorOpened } from "../waiters";

export type ExportedClickActions = {
    left?: Action[];
    right?: Action[];
};

export async function readClickActions(
    ctx: TaskContext,
    item: CapturedItem,
    registry: ItemCaptureRegistry
): Promise<ExportedClickActions> {
    await holdCapturedItem(ctx, item);
    return readHeldClickActions(ctx, registry);
}

export async function readHeldClickActions(
    ctx: TaskContext,
    registry: ItemCaptureRegistry
): Promise<ExportedClickActions> {
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
        const actions = await readActionListFully(ctx, { itemCaptures: registry });
        if (actions.length > 0) result.left = actions;
        if (rightHasActions) await clickGoBack(ctx);
    }

    if (rightHasActions) {
        ctx.getItemSlot("Right Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const actions = await readActionListFully(ctx, { itemCaptures: registry });
        if (actions.length > 0) result.right = actions;
    }

    return result;
}

export function actionPath(snbtPath: string, side: "left" | "right"): string {
    return snbtPath.replace(/\.snbt$/i, `_${side}.htsl`);
}

export function actionReference(snbtReference: string, side: "left" | "right"): string {
    return snbtReference.replace(/\.snbt$/i, `_${side}.htsl`);
}

export function writeActions(ctx: TaskContext, path: string, actions: readonly Action[]): void {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diagnostic of printed.diagnostics) {
        ctx.displayMessage(`&7[export] &e${diagnostic.message}`);
    }
    ensureParentDirs(path);
    FileLib.write(path, printed.source, true);
    ctx.displayMessage(`&7  -> ${path}`);
}
