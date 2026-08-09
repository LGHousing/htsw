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
    applyNpcSettings,
    npcNamesMatch,
    openNpcLeftClickActions,
    openNpcRightClickActions,
    readLeftClickRedirect,
    readNpcSettings,
    renameNpcIfNeeded,
    setLeftClickRedirect,
    validateSupportedNpcFields,
    type NpcSettings,
} from "./housing";
import { openNpcEditorForPos, type NpcListEntry } from "./listNpcs";
import { COST } from "../../housingSync/progress/costs";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
    type ApplicationStep,
} from "../import/applicationProgress";

export type NpcImportPlan = {
    kind: "NPC";
    importable: ImportableNpc;
    trustPlan?: ImportableTrustPlan;
    liveNpc: NpcListEntry;
    nameHandled: boolean;
    settings: NpcSettings;
    settingsHandled: boolean;
    leftClickRedirectHandled: boolean;
    leftPlan: ActionListPlan | null;
    rightPlan: ActionListPlan | null;
};

export type NpcRead = {
    kind: "NPC";
    importable: ImportableNpc;
    trustPlan?: ImportableTrustPlan;
    liveNpc: NpcListEntry;
    settings: NpcSettings;
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
    const settings = readNpcSettings(ctx);
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
        settings,
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
        settings: read.settings,
        settingsHandled:
            (importable.lookAtPlayers === undefined ||
                read.settings.lookAtPlayers === importable.lookAtPlayers) &&
            (importable.hideNameTag === undefined ||
                read.settings.hideNameTag === importable.hideNameTag) &&
            importable.skin === undefined,
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
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    if (!plan.nameHandled) {
        await application.run("rename", () =>
            renameNpcIfNeeded(ctx, plan.liveNpc, plan.importable, session.npcLookup)
        );
    }

    if (!plan.settingsHandled) {
        await application.run("settings", async () => {
            await openNpcEditorForPos(ctx, plan.importable.pos, session.npcLookup);
            await applyNpcSettings(ctx, plan.importable);
        });
    }

    if (plan.leftPlan !== null || !plan.leftClickRedirectHandled) {
        await application.run("openLeftActions", () =>
            openNpcLeftClickActions(ctx, plan.importable, session.npcLookup)
        );
        if (!plan.leftClickRedirectHandled) {
            const redirect = plan.importable.leftClickRedirect;
            if (redirect === undefined) {
                throw new Error(
                    "NPC left-click redirect became unavailable during apply"
                );
            }
            await application.run("leftClickRedirect", () =>
                setLeftClickRedirect(ctx, redirect)
            );
        }
        const leftPlan = plan.leftPlan;
        if (leftPlan !== null) {
            await application.runActionList(
                "leftActions",
                leftPlan,
                session.actions,
                (sync) => applyActionListPlan(ctx, leftPlan, { sync })
            );
        }
    }

    const rightPlan = plan.rightPlan;
    if (rightPlan !== null) {
        await application.run("openRightActions", () =>
            openNpcRightClickActions(ctx, plan.importable, session.npcLookup)
        );
        await application.runActionList(
            "rightActions",
            rightPlan,
            session.actions,
            (sync) => applyActionListPlan(ctx, rightPlan, { sync })
        );
    }
}

export function npcPlanIsNoOp(plan: NpcImportPlan): boolean {
    const leftNoOp = plan.leftPlan === null || plan.leftPlan.diff.operations.length === 0;
    const rightNoOp =
        plan.rightPlan === null || plan.rightPlan.diff.operations.length === 0;
    return (
        plan.nameHandled &&
        plan.settingsHandled &&
        plan.leftClickRedirectHandled &&
        leftNoOp &&
        rightNoOp
    );
}

export function npcPlanApplicationUnits(plan: NpcImportPlan): number {
    return npcApplicationPlan(plan).totalUnits;
}

export function npcApplicationPlan(plan: NpcImportPlan): ApplicationPlan {
    const steps: ApplicationStep[] = [];
    if (npcPlanIsNoOp(plan)) {
        return defineApplicationPlan([workStep("cache", COST.cacheWrite)]);
    }
    const openEditorUnits =
        COST.commandInterval + COST.commandMenuWait + COST.menuClickWait * 3;
    if (!plan.nameHandled) {
        steps.push(workStep("rename", openEditorUnits + COST.chatInput));
    }
    if (!plan.settingsHandled) {
        let settingsUnits = openEditorUnits;
        if (!(
            plan.importable.lookAtPlayers === undefined ||
            plan.settings.lookAtPlayers === plan.importable.lookAtPlayers
        )) {
            settingsUnits += COST.menuClickWait;
        }
        if (!(
            plan.importable.hideNameTag === undefined ||
            plan.settings.hideNameTag === plan.importable.hideNameTag
        )) {
            settingsUnits += COST.menuClickWait;
        }
        if (plan.importable.skin !== undefined) {
            settingsUnits += COST.menuClickWait * 2;
        }
        steps.push(workStep("settings", settingsUnits));
    }
    if (plan.leftPlan !== null || !plan.leftClickRedirectHandled) {
        steps.push(workStep("openLeftActions", openEditorUnits + COST.menuClickWait));
        if (!plan.leftClickRedirectHandled) {
            steps.push(workStep("leftClickRedirect", COST.menuClickWait));
        }
        if (plan.leftPlan !== null) {
            steps.push(actionListStep("leftActions", plan.leftPlan));
        }
    }
    if (plan.rightPlan !== null) {
        steps.push(
            workStep("openRightActions", openEditorUnits + COST.menuClickWait),
            actionListStep("rightActions", plan.rightPlan)
        );
    }
    steps.push(workStep("cache", COST.cacheWrite));
    return defineApplicationPlan(steps);
}
