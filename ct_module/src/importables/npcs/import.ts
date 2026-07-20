import type { ImportableNpc } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import { prereadActionList, type ActionListPlan } from "../../housingSync/actions/plan";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import {
    getActionListTrust,
    getBaselineActionList,
} from "../../housingSync/actions/prepareSync";
import type { ImportSession } from "../imports";
import { importableIdentity } from "../identity";
import { createMissingReferencedShells } from "../references";
import { countReferencedShells } from "../referenceScanner";
import {
    npcNamesMatch,
    openNpcLeftClickActions,
    openNpcRightClickActions,
    readLeftClickRedirect,
    renameNpcIfNeeded,
    setLeftClickRedirect,
    validateSupportedNpcFields,
} from "./shared";
import { openNpcEditorForPos, type NpcListEntry } from "./listNpcs";

export type NpcImportPlan = {
    kind: "NPC";
    importable: ImportableNpc;
    trustPlan?: ImportableTrustPlan;
    liveNpc: NpcListEntry;
    nameHandled: boolean;
    leftClickRedirectHandled: boolean;
    leftPlan: ActionListPlan | null;
    rightPlan: ActionListPlan | null;
};

function leftClickRedirectTrusted(
    importable: ImportableNpc,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (importable.leftClickRedirect === undefined) return true;
    if (plan?.entry?.importable.type !== "NPC") return false;
    return plan.entry.importable.leftClickRedirect === importable.leftClickRedirect;
}

export async function prereadImportableNpc(
    ctx: TaskContext,
    importable: ImportableNpc,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<NpcImportPlan> {
    validateSupportedNpcFields(importable);

    const leftEligible =
        importable.leftClickActions !== undefined &&
        !trustPlan?.trustedChildListPaths.has("leftClickActions");
    const rightEligible =
        importable.rightClickActions !== undefined &&
        !trustPlan?.trustedChildListPaths.has("rightClickActions");
    const redirectEligible =
        importable.leftClickRedirect !== undefined &&
        !leftClickRedirectTrusted(importable, trustPlan);

    const setup = createSetupStepEmitter(
        session.events,
        countReferencedShells(importable) + 1
    );

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const liveNpc = await openNpcEditorForPos(ctx, importable.pos, session.npcLookup);
    setup(`opened NPC ${liveNpc.name}`);

    const nameHandled = npcNamesMatch(liveNpc.name, importable.name);
    let leftClickRedirectHandled = !redirectEligible;
    let leftPlan: ActionListPlan | null = null;
    let rightPlan: ActionListPlan | null = null;

    if (leftEligible || redirectEligible) {
        ctx.getMenuItemSlot("Left Click Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");

        if (redirectEligible) {
            leftClickRedirectHandled =
                readLeftClickRedirect(ctx) === importable.leftClickRedirect;
        }

        if (leftEligible) {
            const leftActions = importable.leftClickActions;
            if (leftActions === undefined) {
                throw new Error("NPC left-click actions became unavailable during pre-read");
            }
            leftPlan = await prereadActionList(ctx, leftActions, {
                session,
                baselineCurrent: getBaselineActionList(trustPlan, "leftClickActions"),
                trust: getActionListTrust(trustPlan, "leftClickActions"),
                conflictTarget: {
                    type: importable.type,
                    identity: importableIdentity(importable),
                    basePath: "leftClickActions",
                },
            });
        }
    }

    if (rightEligible) {
        await openNpcRightClickActions(ctx, importable, session.npcLookup);
        const rightActions = importable.rightClickActions;
        if (rightActions === undefined) {
            throw new Error("NPC right-click actions became unavailable during pre-read");
        }
        rightPlan = await prereadActionList(ctx, rightActions, {
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "rightClickActions"),
            trust: getActionListTrust(trustPlan, "rightClickActions"),
            conflictTarget: {
                type: importable.type,
                identity: importableIdentity(importable),
                basePath: "rightClickActions",
            },
        });
    }

    return {
        kind: "NPC",
        importable,
        trustPlan,
        liveNpc,
        nameHandled,
        leftClickRedirectHandled,
        leftPlan,
        rightPlan,
    };
}

export async function applyImportableNpcPlan(
    ctx: TaskContext,
    plan: NpcImportPlan,
    session: ImportSession
): Promise<void> {
    if (!plan.nameHandled) {
        await renameNpcIfNeeded(ctx, plan.liveNpc, plan.importable, session.npcLookup);
    }

    if (plan.leftPlan !== null || !plan.leftClickRedirectHandled) {
        await openNpcLeftClickActions(ctx, plan.importable, session.npcLookup);
        if (!plan.leftClickRedirectHandled) {
            const redirect = plan.importable.leftClickRedirect;
            if (redirect === undefined) {
                throw new Error("NPC left-click redirect became unavailable during apply");
            }
            await setLeftClickRedirect(ctx, redirect);
        }
        if (plan.leftPlan !== null) {
            await applyActionListPlan(ctx, plan.leftPlan, { session });
        }
    }

    if (plan.rightPlan !== null) {
        await openNpcRightClickActions(ctx, plan.importable, session.npcLookup);
        await applyActionListPlan(ctx, plan.rightPlan, { session });
    }
}

export function npcPlanIsNoOp(plan: NpcImportPlan): boolean {
    const leftNoOp = plan.leftPlan === null || plan.leftPlan.diff.operations.length === 0;
    const rightNoOp =
        plan.rightPlan === null || plan.rightPlan.diff.operations.length === 0;
    return plan.nameHandled && plan.leftClickRedirectHandled && leftNoOp && rightNoOp;
}
