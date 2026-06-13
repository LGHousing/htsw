import type { ImportableRegion, Pos } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import {
    prereadActionList,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../housingSync/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ImportSession } from "../imports";
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
    // The parser treats `bounds` as optional, so a bounds-less region reaches
    // the importer. Fail with an actionable message instead of a TypeError.
    if ((importable.bounds as unknown) === undefined) {
        throw new Error(
            `Region "${importable.name}" has no bounds in import.json — add bounds before importing`
        );
    }
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
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<RegionImportPlan> {
    const enterEligible =
        importable.onEnterActions !== undefined &&
        !trustPlan?.trustedListPaths.has("onEnterActions");
    const exitEligible =
        importable.onExitActions !== undefined &&
        !trustPlan?.trustedListPaths.has("onExitActions");

    const regionOpenSteps = (enterEligible || exitEligible) ? 3 : 0;
    const setup = createSetupStepEmitter(session.events, countReferencedShells(importable) + regionOpenSteps);

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
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "onEnterActions"),
            trust: getActionListTrust(trustPlan, "onEnterActions"),
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
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "onExitActions"),
            trust: getActionListTrust(trustPlan, "onExitActions"),
        });
    }

    return { kind: "REGION", importable, trustPlan, enterPlan, exitPlan };
}

export async function applyImportableRegionPlan(
    ctx: TaskContext,
    plan: RegionImportPlan,
    session: ImportSession
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
        await applyActionListPlan(ctx, plan.enterPlan, { session });
        if (plan.exitPlan !== null) {
            await clickGoBack(ctx);
        }
    }

    if (plan.exitPlan !== null) {
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.exitPlan, { session });
    }
}
