import type { ImportableNpc } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import { createProgressGroup } from "../../housingSync/progress/group";
import type { ImportableTrustPlan } from "../../importCache";
import TaskContext from "../../tasks/context";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
} from "../../housingSync/actions/prepareSync";
import type { ImportContext } from "../import/context";
import { importableIdentity } from "../identity";
import {
    npcNamesMatch,
    openNpcLeftClickActions,
    openNpcRightClickActions,
    readLeftClickRedirect,
    renameNpcIfNeeded,
    setLeftClickRedirect,
    validateSupportedNpcFields,
} from "./housing";
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

export type NpcRead = {
    kind: "NPC";
    importable: ImportableNpc;
    trustPlan?: ImportableTrustPlan;
    liveNpc: NpcListEntry;
    leftClickRedirect: boolean | null;
    left: ActionListSyncScanResult;
    right: ActionListSyncScanResult;
};

function leftClickRedirectTrusted(
    importable: ImportableNpc,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (importable.leftClickRedirect === undefined) return true;
    if (plan?.trustMode !== true || plan.entry?.importable.type !== "NPC") return false;
    return plan.entry.importable.leftClickRedirect === importable.leftClickRedirect;
}

export async function scanImportableNpc(
    ctx: TaskContext,
    importable: ImportableNpc,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<NpcRead> {
    validateSupportedNpcFields(importable);
    const redirectEligible =
        importable.leftClickRedirect !== undefined &&
        !leftClickRedirectTrusted(importable, trustPlan);

    const setup = createSetupStepEmitter(session.actions.events, 1);

    const liveNpc = await openNpcEditorForPos(ctx, importable.pos, session.npcLookup);
    setup(`opened NPC ${liveNpc.name}`);

    const leftEditor = { opened: false };
    const progress = createProgressGroup(session.actions.events, 2);
    const left = await scanActionListSync(ctx, {
        desired: importable.leftClickActions,
        sync: session.actions,
        trustPlan,
        basePath: "leftClickActions",
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "leftClickActions",
        },
        open: async () => {
            await openNpcLeftClickActions(ctx, importable, session.npcLookup);
            leftEditor.opened = true;
        },
        progress: progress.part(0),
    });
    if (redirectEligible && !leftEditor.opened) {
        await openNpcLeftClickActions(ctx, importable, session.npcLookup);
        leftEditor.opened = true;
    }
    const leftClickRedirect = redirectEligible ? readLeftClickRedirect(ctx) : null;

    const right = await scanActionListSync(ctx, {
        desired: importable.rightClickActions,
        sync: session.actions,
        trustPlan,
        basePath: "rightClickActions",
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "rightClickActions",
        },
        open: async () => {
            await openNpcRightClickActions(ctx, importable, session.npcLookup);
        },
        progress: progress.part(1),
    });

    return {
        kind: "NPC",
        importable,
        trustPlan,
        liveNpc,
        leftClickRedirect,
        left,
        right,
    };
}

export async function hydrateImportableNpc(
    ctx: TaskContext,
    read: NpcRead
): Promise<void> {
    if (read.left.kind === "hydrate") {
        read.left = await hydrateActionListSync(ctx, read.left);
    }
    if (read.right.kind === "hydrate") {
        read.right = await hydrateActionListSync(ctx, read.right);
    }
}

export function planImportableNpc(read: NpcRead): NpcImportPlan {
    const { importable } = read;
    return {
        kind: "NPC",
        importable,
        trustPlan: read.trustPlan,
        liveNpc: read.liveNpc,
        nameHandled: npcNamesMatch(read.liveNpc.name, importable.name),
        leftClickRedirectHandled:
            read.leftClickRedirect === null ||
            read.leftClickRedirect === importable.leftClickRedirect,
        leftPlan: actionListPlanFromRead(read.left),
        rightPlan: actionListPlanFromRead(read.right),
    };
}

export async function applyImportableNpcPlan(
    ctx: TaskContext,
    plan: NpcImportPlan,
    session: ImportContext
): Promise<void> {
    if (!plan.nameHandled) {
        await renameNpcIfNeeded(ctx, plan.liveNpc, plan.importable, session.npcLookup);
    }

    if (plan.leftPlan !== null || !plan.leftClickRedirectHandled) {
        await openNpcLeftClickActions(ctx, plan.importable, session.npcLookup);
        if (!plan.leftClickRedirectHandled) {
            const redirect = plan.importable.leftClickRedirect;
            if (redirect === undefined) {
                throw new Error(
                    "NPC left-click redirect became unavailable during apply"
                );
            }
            await setLeftClickRedirect(ctx, redirect);
        }
        if (plan.leftPlan !== null) {
            await applyActionListPlan(ctx, plan.leftPlan, { sync: session.actions });
        }
    }

    if (plan.rightPlan !== null) {
        await openNpcRightClickActions(ctx, plan.importable, session.npcLookup);
        await applyActionListPlan(ctx, plan.rightPlan, { sync: session.actions });
    }
}

export function npcPlanIsNoOp(plan: NpcImportPlan): boolean {
    const leftNoOp = plan.leftPlan === null || plan.leftPlan.diff.operations.length === 0;
    const rightNoOp =
        plan.rightPlan === null || plan.rightPlan.diff.operations.length === 0;
    return plan.nameHandled && plan.leftClickRedirectHandled && leftNoOp && rightNoOp;
}
