import type { ImportableRegion, Pos } from "htsw/types";

import {
    applyActionListPlan,
    prereadActionList,
    type ActionListPlan,
} from "../../importer/actions/sync";
import { clickGoBack } from "../../importer/gui/menuUtils";
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

export type RegionImportPlan = {
    kind: "REGION";
    importable: ImportableRegion;
    trustPlan?: ImportableTrustPlan;
    enterPlan: ActionListPlan | null;
    exitPlan: ActionListPlan | null;
};

async function setRegionCorner(ctx: TaskContext, pos: Pos, corner: "A" | "B"): Promise<void> {
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
}

async function ensureRegionOpen(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {
    await setRegionCorner(ctx, importable.bounds.from, "A");
    await setRegionCorner(ctx, importable.bounds.to, "B");

    const alreadyExists = (await openRegionEditor(ctx, importable.name)) === "opened";

    if (!alreadyExists) {
        await ctx.runCommand(`/region create ${importable.name}`);
        await timedWaitForUnformattedMessage(ctx, `Created region ${importable.name}!`);
        await openRegionEditor(ctx, importable.name);
    } else {
        ctx.getItemSlot("Move Region").click();
        await timedWaitForUnformattedMessage(
            ctx,
            "Updated region to your current selection!",
            "messageClickWait"
        );
        await openRegionEditor(ctx, importable.name);
    }
}

export async function prereadImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<RegionImportPlan> {
    const enterEligible =
        importable.onEnterActions !== undefined &&
        !trustPlan?.trustedListPaths.has("onEnterActions");
    const exitEligible =
        importable.onExitActions !== undefined &&
        !trustPlan?.trustedListPaths.has("onExitActions");

    const regionOpenSteps = (enterEligible || exitEligible) ? 3 : 0;
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + regionOpenSteps);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    if (!enterEligible && !exitEligible) {
        return { kind: "REGION", importable, trustPlan, enterPlan: null, exitPlan: null };
    }

    await ensureRegionOpen(ctx, importable);
    setup(`set region corner A`);
    setup(`set region corner B`);
    setup(`opened region ${importable.name}`);

    let enterPlan: ActionListPlan | null = null;
    if (enterEligible) {
        ctx.getItemSlot("Entry Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        enterPlan = await prereadActionList(ctx, importable.onEnterActions!, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "onEnterActions"),
            trust: getActionListTrust(trustPlan, "onEnterActions"),
            events,
        });
        if (exitEligible) {
            await clickGoBack(ctx);
        }
    }

    let exitPlan: ActionListPlan | null = null;
    if (exitEligible) {
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        exitPlan = await prereadActionList(ctx, importable.onExitActions!, {
            itemRegistry,
            baselineCurrent: getBaselineActionList(trustPlan, "onExitActions"),
            trust: getActionListTrust(trustPlan, "onExitActions"),
            events,
        });
    }

    return { kind: "REGION", importable, trustPlan, enterPlan, exitPlan };
}

export async function applyImportableRegionPlan(
    ctx: TaskContext,
    plan: RegionImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    // ensureRegionOpen re-runs the full teleport + pos-set + open cycle
    // even though preread already did it. Between passes, other importables
    // may have moved the player and the menu closed, so both the corner
    // positions and the editor need to be re-established.
    if (plan.enterPlan === null && plan.exitPlan === null) {
        await ensureRegionOpen(ctx, plan.importable);
        return;
    }

    await ensureRegionOpen(ctx, plan.importable);

    if (plan.enterPlan !== null) {
        ctx.getItemSlot("Entry Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.enterPlan, { itemRegistry, events });
        if (plan.exitPlan !== null) {
            await clickGoBack(ctx);
        }
    }

    if (plan.exitPlan !== null) {
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.exitPlan, { itemRegistry, events });
    }
}
