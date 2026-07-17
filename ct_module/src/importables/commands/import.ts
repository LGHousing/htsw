import type { Action, Importable, ImportableCommand } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import { prereadActionList, type ActionListPlan } from "../../housingSync/actions/plan";
import {
    actionsFullyHydrated,
    fullyHydratedActionsFromSlots,
} from "../../housingSync/actions/hydration/plan";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
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
    applyCommandSettings,
    commandSettingsMatch,
    desiredCommandSettings,
    ensureCommandExists,
    openCommandActionsEditor,
    openCommandSettings,
    readOpenCommandSettings,
} from "./shared";

export type CommandImportPlan = {
    kind: "COMMAND";
    importable: ImportableCommand;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    settingsHandled: boolean;
};

export async function prereadImportableCommand(
    ctx: TaskContext,
    importable: ImportableCommand,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<CommandImportPlan> {
    const setup = createSetupStepEmitter(
        session.events,
        countReferencedShells(importable) + 1
    );

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const actionsTrusted = trustPlan?.trustedChildListPaths.has("actions") ?? false;
    const settingsTrusted = commandSettingsTrusted(importable, trustPlan);

    if (actionsTrusted && settingsTrusted) {
        setup(`skipped /${importable.name}`);
        return {
            kind: "COMMAND",
            importable,
            trustPlan,
            actionsPlan: null,
            settingsHandled: true,
        };
    }

    let created = false;
    let actionsPlan: ActionListPlan | null = null;
    if (importable.actions !== undefined && !actionsTrusted) {
        created = (await openCommandActionsEditor(ctx, importable.name)) === "created";
        setup(created ? `created /${importable.name}` : `opened /${importable.name}`);
        actionsPlan = await prereadActionList(ctx, importable.actions, {
            session,
            baselineCurrent: getBaselineActionList(trustPlan, "actions"),
            trust: getActionListTrust(trustPlan, "actions"),
            conflictTarget: {
                type: importable.type,
                identity: importableIdentity(importable),
                basePath: "actions",
            },
        });
    } else {
        created = (await ensureCommandExists(ctx, importable.name)) === "created";
        setup(created ? `created /${importable.name}` : `checked /${importable.name}`);
    }

    let settingsHandled = settingsTrusted;
    if (!settingsHandled) {
        if (created) {
            settingsHandled = commandSettingsMatch(
                { mode: "Self", requiredPriority: 0, listed: true },
                desiredCommandSettings(importable)
            );
        } else {
            await openCommandSettings(ctx, importable.name);
            settingsHandled = commandSettingsMatch(
                readOpenCommandSettings(ctx),
                desiredCommandSettings(importable)
            );
        }
    }

    return { kind: "COMMAND", importable, trustPlan, actionsPlan, settingsHandled };
}

export async function applyImportableCommandPlan(
    ctx: TaskContext,
    plan: CommandImportPlan,
    session: ImportSession
): Promise<void> {
    if (plan.actionsPlan !== null) {
        await openCommandActionsEditor(ctx, plan.importable.name);
        await applyActionListPlan(ctx, plan.actionsPlan, { session });
    }

    if (!plan.settingsHandled) {
        await openCommandSettings(ctx, plan.importable.name);
        await applyCommandSettings(ctx, plan.importable);
    }
}

export function commandPlanIsNoOp(plan: CommandImportPlan): boolean {
    const actionsNoOp =
        plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
    return actionsNoOp && plan.settingsHandled;
}

export function reconstructObservedCommand(plan: CommandImportPlan): Importable | null {
    if (plan.actionsPlan === null) return null;
    const actions = fullyHydratedActionsFromSlots(plan.actionsPlan.observed);
    if (actions === null) return null;
    return { type: "COMMAND", name: plan.importable.name, actions };
}

export function reconstructPartialCommand(
    plan: CommandImportPlan,
    result: ActionListApplyResult | null
): Importable | null {
    const current = result?.currentSnapshot;
    if (current === undefined || !actionsFullyHydrated(current)) return null;
    return {
        type: "COMMAND",
        name: plan.importable.name,
        actions: current.slice() as Action[],
    };
}

function commandSettingsTrusted(
    importable: ImportableCommand,
    plan: ImportableTrustPlan | undefined
): boolean {
    if (plan?.entry?.importable.type !== "COMMAND") {
        return false;
    }
    const cached = plan.entry.importable;
    return commandSettingsMatch(
        {
            mode: cached.mode ?? "Self",
            requiredPriority: cached.requiredPriority ?? 0,
            listed: cached.listed ?? true,
        },
        desiredCommandSettings(importable)
    );
}
