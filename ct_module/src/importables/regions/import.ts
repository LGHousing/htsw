import type { ImportableRegion, Pos } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import {
    actionListPlanNeedsApply,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
} from "../../housingSync/actions/prepareSync";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import { createProgressGroup } from "../../housingSync/progress/group";
import { ensureCreativeFlight } from "../../housingSync/sideEffects";
import TaskContext from "../../tasks/context";
import type { ImportContext } from "../import/context";
import { importableIdentity } from "../identity";
import {
    regionCornerSet,
    regionCreated,
    regionMovedToSelection,
    teleportSucceeded,
} from "../waiters";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { openRegionEditor } from "./housing";
import { regionBoundsEqual } from "./bounds";
import { recordEmptyRegionShell } from "../import/emptyShells";
import { COST, REGION_BOUNDS_CHANGE_UNITS } from "../../housingSync/progress/costs";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

export type RegionImportPlan = {
    kind: "REGION";
    importable: ImportableRegion;
    trustPlan?: ImportableTrustPlan;
    liveRegion: RegionListEntry | null;
    boundsMatch: boolean;
    enterPlan: ActionListPlan | null;
    exitPlan: ActionListPlan | null;
};

export type RegionRead = {
    kind: "REGION";
    importable: ImportableRegion;
    trustPlan?: ImportableTrustPlan;
    liveRegion: RegionListEntry | null;
    enter: ActionListSyncScanResult;
    exit: ActionListSyncScanResult;
};

async function setRegionCorner(
    ctx: TaskContext,
    pos: Pos,
    corner: "A" | "B"
): Promise<void> {
    await ctx.expectAfter(
        () => ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`),
        teleportSucceeded(pos)
    );
    await ctx.expectAfter(
        () => ctx.runCommand(`//pos${corner}`),
        regionCornerSet(pos, corner)
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
    const bounds = importable.bounds;
    if (!(await ensureCreativeFlight(ctx))) {
        throw new Error("Could not enter flight mode before setting region corners.");
    }
    await setRegionCorner(ctx, bounds.from, "A");
    await setRegionCorner(ctx, bounds.to, "B");
}

async function applyRegionActionPlans(
    ctx: TaskContext,
    plan: RegionImportPlan,
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const enterPlan = plan.enterPlan;
    if (actionListPlanNeedsApply(enterPlan)) {
        await application.run("openEnterActions", async () => {
            ctx.getItemSlot("Entry Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
        });
        await application.runActionList(
            "enterActions",
            enterPlan,
            session.actions,
            (sync) => applyActionListPlan(ctx, enterPlan, { sync })
        );
    }

    const exitPlan = plan.exitPlan;
    if (actionListPlanNeedsApply(exitPlan)) {
        // Reopen by command instead of clickGoBack-ing up to the region editor:
        // it's a parent-less /region edit "Close" menu, and a deep onEnter unwind
        // can't be relied on to land exactly back on it. Reopening re-establishes
        // a known menu regardless of where onEnter ended.
        if (actionListPlanNeedsApply(enterPlan)) {
            await application.run("reopenForExit", () =>
                openRegionEditor(ctx, plan.importable.name)
            );
        }
        await application.run("openExitActions", async () => {
            ctx.getItemSlot("Exit Actions").click();
            await timedWaitForMenu(ctx, "menuClickWait");
        });
        await application.runActionList(
            "exitActions",
            exitPlan,
            session.actions,
            (sync) => applyActionListPlan(ctx, exitPlan, { sync })
        );
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
    plan: RegionImportPlan,
    session: ImportContext
): Promise<void> {
    if (plan.liveRegion === null) {
        if (
            session.ensuredReferencedShells.regions.has(
                plan.importable.name.toLowerCase()
            )
        ) {
            await moveExistingRegionToBounds(ctx, plan.importable);
        } else {
            await createRegionWithBounds(ctx, plan.importable);
            await recordEmptyRegionShell(ctx, session, plan.importable);
        }
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

export async function scanImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<RegionRead> {
    const setup = createSetupStepEmitter(session.actions.events, 2);
    const liveRegion = await findLiveRegion(ctx, importable.name);
    setup(`read region list`);
    const current = liveRegion === null ? { kind: "known-empty" as const } : undefined;
    const progress = createProgressGroup(session.actions.events, 2);

    const enter = await scanActionListSync(ctx, {
        desired: importable.onEnterActions,
        sync: session.actions,
        trustPlan: liveRegion === null ? undefined : trustPlan,
        basePath: "onEnterActions",
        current,
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "onEnterActions",
        },
        open: () => openRegionActionList(ctx, importable.name, "Entry Actions"),
        progress: progress.part(0),
    });
    const exit = await scanActionListSync(ctx, {
        desired: importable.onExitActions,
        sync: session.actions,
        trustPlan: liveRegion === null ? undefined : trustPlan,
        basePath: "onExitActions",
        current,
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "onExitActions",
        },
        open: () => openRegionActionList(ctx, importable.name, "Exit Actions"),
        progress: progress.part(1),
    });
    return { kind: "REGION", importable, trustPlan, liveRegion, enter, exit };
}

async function openRegionActionList(
    ctx: TaskContext,
    name: string,
    slot: "Entry Actions" | "Exit Actions"
): Promise<void> {
    if ((await openRegionEditor(ctx, name)) !== "opened") {
        throw new Error(`Region ${name} disappeared during read.`);
    }
    ctx.getItemSlot(slot).click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function hydrateImportableRegion(
    ctx: TaskContext,
    read: RegionRead
): Promise<void> {
    if (read.enter.kind === "hydrate") {
        read.enter = await hydrateActionListSync(ctx, read.enter);
    }
    if (read.exit.kind === "hydrate") {
        read.exit = await hydrateActionListSync(ctx, read.exit);
    }
}

export function planImportableRegion(read: RegionRead): RegionImportPlan {
    return {
        kind: "REGION",
        importable: read.importable,
        trustPlan: read.trustPlan,
        liveRegion: read.liveRegion,
        boundsMatch:
            read.liveRegion !== null &&
            regionBoundsEqual(read.liveRegion.bounds, read.importable.bounds),
        enterPlan: actionListPlanFromRead(read.enter),
        exitPlan: actionListPlanFromRead(read.exit),
    };
}

export async function applyImportableRegionPlan(
    ctx: TaskContext,
    plan: RegionImportPlan,
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    if (
        !actionListPlanNeedsApply(plan.enterPlan) &&
        !actionListPlanNeedsApply(plan.exitPlan)
    ) {
        if (regionPlanIsNoOp(plan)) return;
        // Region created/moved to bounds; nothing to edit. No clickGoBack — the
        // /region edit editor is a parent-less "Close" menu, and the next
        // importable opens its own menu by command anyway.
        await application.run("openEditor", () =>
            ensureRegionEditorForApply(ctx, plan, session)
        );
        return;
    }

    await application.run("openEditor", () =>
        ensureRegionEditorForApply(ctx, plan, session)
    );
    await applyRegionActionPlans(ctx, plan, session, application);
}

export function regionPlanIsNoOp(plan: RegionImportPlan): boolean {
    const enterNoOp = !actionListPlanNeedsApply(plan.enterPlan);
    const exitNoOp = !actionListPlanNeedsApply(plan.exitPlan);
    return plan.liveRegion !== null && plan.boundsMatch && enterNoOp && exitNoOp;
}

export function regionApplicationPlan(
    plan: RegionImportPlan,
    session: ImportContext
): ApplicationPlan {
    const steps: ApplicationStep[] = [];
    if (regionPlanIsNoOp(plan)) {
        return defineApplicationPlan([workStep("cache", COST.cacheWrite)]);
    }
    const boundsChange = plan.liveRegion === null || !plan.boundsMatch;
    const shellPlanned =
        plan.liveRegion === null &&
        session.plannedReferencedShells.regions.has(plan.importable.name.toLowerCase());
    steps.push(
        workStep(
            "openEditor",
            boundsChange
                ? REGION_BOUNDS_CHANGE_UNITS +
                      (plan.liveRegion === null && !shellPlanned ? COST.cacheWrite : 0)
                : COST.commandInterval + COST.commandMenuWait
        )
    );
    if (actionListPlanNeedsApply(plan.enterPlan)) {
        steps.push(
            workStep("openEnterActions", COST.menuClickWait),
            actionListStep("enterActions", plan.enterPlan)
        );
    }
    if (actionListPlanNeedsApply(plan.exitPlan)) {
        if (actionListPlanNeedsApply(plan.enterPlan)) {
            steps.push(
                workStep("reopenForExit", COST.commandInterval + COST.commandMenuWait)
            );
        }
        steps.push(
            workStep("openExitActions", COST.menuClickWait),
            actionListStep("exitActions", plan.exitPlan)
        );
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}
