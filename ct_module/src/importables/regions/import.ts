import type { ImportableRegion, Pos } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import {
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import { ensureCreativeFlight } from "../../housingSync/sideEffects";
import TaskContext from "../../tasks/context";
import { prereadActionListUsingTrust } from "../actionListHelpers";
import type { ImportSession } from "../imports";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import {
    regionCornerSet,
    regionCreated,
    regionMovedToSelection,
    teleportSucceeded,
} from "../waiters";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { openRegionEditor } from "./shared";

export type RegionImportPlan = {
    kind: "REGION";
    importable: ImportableRegion;
    trustPlan?: ImportableTrustPlan;
    liveRegion: RegionListEntry | null;
    boundsMatch: boolean;
    enterPlan: ActionListPlan | null;
    exitPlan: ActionListPlan | null;
};

async function setRegionCorner(ctx: TaskContext, pos: Pos, corner: "A" | "B"): Promise<void> {
    await ctx.expectAfter(
        () => ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`),
        teleportSucceeded(pos)
    );
    await ctx.expectAfter(
        () => ctx.runCommand(`//pos${corner}`),
        regionCornerSet(pos, corner)
    );
}

function requireRegionBounds(importable: ImportableRegion): { from: Pos; to: Pos } {
    if ((importable.bounds as unknown) === undefined) {
        throw new Error(
            `Region "${importable.name}" has no bounds in import.json — add bounds before importing`
        );
    }
    return importable.bounds;
}

function normalizeBounds(bounds: { from: Pos; to: Pos }): { from: Pos; to: Pos } {
    return {
        from: {
            x: Math.min(bounds.from.x, bounds.to.x),
            y: Math.min(bounds.from.y, bounds.to.y),
            z: Math.min(bounds.from.z, bounds.to.z),
        },
        to: {
            x: Math.max(bounds.from.x, bounds.to.x),
            y: Math.max(bounds.from.y, bounds.to.y),
            z: Math.max(bounds.from.z, bounds.to.z),
        },
    };
}

function regionBoundsMatch(
    liveBounds: { from: Pos; to: Pos } | null,
    desiredBounds: { from: Pos; to: Pos }
): boolean {
    if (liveBounds === null) return false;
    const live = normalizeBounds(liveBounds);
    const desired = normalizeBounds(desiredBounds);
    return (
        live.from.x === desired.from.x &&
        live.from.y === desired.from.y &&
        live.from.z === desired.from.z &&
        live.to.x === desired.to.x &&
        live.to.y === desired.to.y &&
        live.to.z === desired.to.z
    );
}

async function findLiveRegion(
    ctx: TaskContext,
    name: string
): Promise<RegionListEntry | null> {
    const regions = await listAllRegions(ctx);
    for (let i = 0; i < regions.length; i++) {
        if (regions[i].name === name) return regions[i];
    }
    return null;
}

async function setDesiredRegionSelection(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {
    const bounds = requireRegionBounds(importable);
    if (!(await ensureCreativeFlight(ctx))) {
        throw new Error("Could not enter flight mode before setting region corners.");
    }
    await setRegionCorner(ctx, bounds.from, "A");
    await setRegionCorner(ctx, bounds.to, "B");
}

async function createEmptyActionPlan(
    ctx: TaskContext,
    desired: ImportableRegion["onEnterActions"],
    session: ImportSession,
    trustPlan: ImportableTrustPlan | undefined,
    basePath: "onEnterActions" | "onExitActions"
): Promise<ActionListPlan | null> {
    if (desired === undefined) return null;
    if (trustPlan?.trustedListPaths.has(basePath)) return null;
    return await prereadActionListUsingTrust(ctx, desired, {
        session,
        observed: [],
        trustPlan,
        basePath,
    });
}

async function createTrustedRegionActionPlan(
    ctx: TaskContext,
    desired: ImportableRegion["onEnterActions"],
    session: ImportSession,
    trustPlan: ImportableTrustPlan | undefined,
    basePath: "onEnterActions" | "onExitActions"
): Promise<ActionListPlan | null> {
    if (desired === undefined) return null;
    if (trustPlan?.trustedListPaths.has(basePath)) return null;
    return await prereadActionListUsingTrust(ctx, desired, {
        session,
        trustPlan,
        basePath,
    });
}

async function readLiveRegionActionPlans(
    ctx: TaskContext,
    importable: ImportableRegion,
    session: ImportSession,
    trustPlan: ImportableTrustPlan | undefined,
    enterEligible: boolean,
    exitEligible: boolean
): Promise<{ enterPlan: ActionListPlan | null; exitPlan: ActionListPlan | null }> {
    await openRegionEditor(ctx, importable.name);

    let enterPlan: ActionListPlan | null = null;
    if (enterEligible) {
        ctx.getItemSlot("Entry Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        enterPlan = await prereadActionListUsingTrust(ctx, importable.onEnterActions!, {
            session,
            trustPlan,
            basePath: "onEnterActions",
        });
    }

    let exitPlan: ActionListPlan | null = null;
    if (exitEligible) {
        // Reopen by command instead of clickGoBack-ing up to the region editor:
        // it's a parent-less /region edit "Close" menu, and a deep onEnter read
        // can't be relied on to land exactly back on it.
        if (enterEligible) {
            await openRegionEditor(ctx, importable.name);
        }
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        exitPlan = await prereadActionListUsingTrust(ctx, importable.onExitActions!, {
            session,
            trustPlan,
            basePath: "onExitActions",
        });
    }

    return { enterPlan, exitPlan };
}

async function applyRegionActionPlans(
    ctx: TaskContext,
    plan: RegionImportPlan,
    session: ImportSession
): Promise<void> {
    if (plan.enterPlan !== null) {
        ctx.getItemSlot("Entry Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.enterPlan, { session });
    }

    if (plan.exitPlan !== null) {
        // Reopen by command instead of clickGoBack-ing up to the region editor:
        // it's a parent-less /region edit "Close" menu, and a deep onEnter unwind
        // can't be relied on to land exactly back on it. Reopening re-establishes
        // a known menu regardless of where onEnter ended.
        if (plan.enterPlan !== null) {
            await openRegionEditor(ctx, plan.importable.name);
        }
        ctx.getItemSlot("Exit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        await applyActionListPlan(ctx, plan.exitPlan, { session });
    }
}

async function moveExistingRegionToBounds(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {
    await setDesiredRegionSelection(ctx, importable);
    if ((await openRegionEditor(ctx, importable.name)) !== "opened") {
        await ctx.expectAfter(
            () => ctx.runCommand(`/region create ${importable.name}`),
            regionCreated(importable.name)
        );
        await openRegionEditor(ctx, importable.name);
        return;
    }
    await ctx.expectAfter(
        () => ctx.getItemSlot("Move Region").click(),
        regionMovedToSelection()
    );
    await openRegionEditor(ctx, importable.name);
}

async function createRegionWithBounds(
    ctx: TaskContext,
    importable: ImportableRegion
): Promise<void> {
    await setDesiredRegionSelection(ctx, importable);
    await ctx.expectAfter(
        () => ctx.runCommand(`/region create ${importable.name}`),
        regionCreated(importable.name)
    );
    await openRegionEditor(ctx, importable.name);
}

async function ensureRegionEditorForApply(
    ctx: TaskContext,
    plan: RegionImportPlan
): Promise<void> {
    if (plan.liveRegion === null) {
        await createRegionWithBounds(ctx, plan.importable);
        return;
    }
    if (!plan.boundsMatch) {
        await moveExistingRegionToBounds(ctx, plan.importable);
        return;
    }
    if ((await openRegionEditor(ctx, plan.importable.name)) !== "opened") {
        await createRegionWithBounds(ctx, plan.importable);
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

    requireRegionBounds(importable);
    const regionOpenSteps = (enterEligible || exitEligible) ? 2 : 1;
    const setup = createSetupStepEmitter(session.events, countReferencedShells(importable) + regionOpenSteps);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    if (trustPlan?.trustMode === true && trustPlan.entry?.importable.type === "REGION") {
        const cachedRegion = trustPlan.entry.importable;
        const liveRegion = {
            index: 0,
            name: importable.name,
            bounds: cachedRegion.bounds,
        };
        return {
            kind: "REGION",
            importable,
            trustPlan,
            liveRegion,
            boundsMatch: regionBoundsMatch(cachedRegion.bounds, importable.bounds),
            enterPlan: await createTrustedRegionActionPlan(
                ctx,
                importable.onEnterActions,
                session,
                trustPlan,
                "onEnterActions"
            ),
            exitPlan: await createTrustedRegionActionPlan(
                ctx,
                importable.onExitActions,
                session,
                trustPlan,
                "onExitActions"
            ),
        };
    }

    const liveRegion = await findLiveRegion(ctx, importable.name);
    setup(`read region list`);
    const boundsMatch =
        liveRegion !== null && regionBoundsMatch(liveRegion.bounds, importable.bounds);

    if (!enterEligible && !exitEligible) {
        return {
            kind: "REGION",
            importable,
            trustPlan,
            liveRegion,
            boundsMatch,
            enterPlan: null,
            exitPlan: null,
        };
    }

    if (liveRegion === null) {
        const enterPlan = await createEmptyActionPlan(
            ctx,
            importable.onEnterActions,
            session,
            trustPlan,
            "onEnterActions"
        );
        const exitPlan = await createEmptyActionPlan(
            ctx,
            importable.onExitActions,
            session,
            trustPlan,
            "onExitActions"
        );
        return {
            kind: "REGION",
            importable,
            trustPlan,
            liveRegion,
            boundsMatch,
            enterPlan,
            exitPlan,
        };
    }

    const plans = await readLiveRegionActionPlans(
        ctx,
        importable,
        session,
        trustPlan,
        enterEligible,
        exitEligible
    );
    setup(`opened region ${importable.name}`);

    return {
        kind: "REGION",
        importable,
        trustPlan,
        liveRegion,
        boundsMatch,
        enterPlan: plans.enterPlan,
        exitPlan: plans.exitPlan,
    };
}

export async function applyImportableRegionPlan(
    ctx: TaskContext,
    plan: RegionImportPlan,
    session: ImportSession
): Promise<void> {
    if (plan.enterPlan === null && plan.exitPlan === null) {
        if (regionPlanIsNoOp(plan)) return;
        // Region created/moved to bounds; nothing to edit. No clickGoBack — the
        // /region edit editor is a parent-less "Close" menu, and the next
        // importable opens its own menu by command anyway.
        await ensureRegionEditorForApply(ctx, plan);
        return;
    }

    await ensureRegionEditorForApply(ctx, plan);
    await applyRegionActionPlans(ctx, plan, session);
}

export function regionPlanIsNoOp(plan: RegionImportPlan): boolean {
    const enterNoOp =
        plan.enterPlan === null || plan.enterPlan.diff.operations.length === 0;
    const exitNoOp =
        plan.exitPlan === null || plan.exitPlan.diff.operations.length === 0;
    return plan.liveRegion !== null && plan.boundsMatch && enterNoOp && exitNoOp;
}
