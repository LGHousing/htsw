import type { ImportableRegion, Pos } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import { clickGoBack } from "../../importer/gui/helpers";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../importer/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../importer/importEvents";
import { createSetupStepEmitter } from "../../importer/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { openRegionEditor } from "./shared";

export async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<void> {
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + 3);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const setPos = async (pos: Pos, corner: "A" | "B") => {
        await ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`);
        await timedWaitForUnformattedMessage(
            ctx,
            `Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`
        );

        await ctx.runCommand(`//pos${corner}`);
        await timedWaitForUnformattedMessage(
            ctx,
            `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`
        );
    };

    await setPos(importable.bounds.from, "A");
    setup(`set region corner A`);

    await setPos(importable.bounds.to, "B");
    setup(`set region corner B`);

    const alreadyExists = (await openRegionEditor(ctx, importable.name)) === "opened";

    if (!alreadyExists) {
        await ctx.runCommand(`/region create ${importable.name}`);
        await timedWaitForUnformattedMessage(ctx, `Created region ${importable.name}!`);

        await openRegionEditor(ctx, importable.name);
    } else {
        ctx.getItemSlot("Move Region").click();
        await timedWaitForUnformattedMessage(ctx, "Updated region to your current selection!", "messageClickWait");

        await openRegionEditor(ctx, importable.name);
    }
    setup(`opened region ${importable.name}`);

    if (importable.onEnterActions && !trustPlan?.trustedListPaths.has("onEnterActions")) {
        ctx.getItemSlot("Entry Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await syncActionList(ctx, importable.onEnterActions, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "onEnterActions"),
            trust: getActionListTrust(trustPlan, "onEnterActions"),
            events,
        });

        if (
            importable.onExitActions &&
            !trustPlan?.trustedListPaths.has("onExitActions")
        ) {
            await clickGoBack(ctx);
        }
    }

    if (importable.onExitActions && !trustPlan?.trustedListPaths.has("onExitActions")) {
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await syncActionList(ctx, importable.onExitActions, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "onExitActions"),
            trust: getActionListTrust(trustPlan, "onExitActions"),
            events,
        });
    }
}
