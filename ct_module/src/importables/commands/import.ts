import type { Action, Importable, ImportableCommand } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import {
    actionsFullyHydrated,
    fullyHydratedActionsFromSlots,
} from "../../housingSync/actions/hydration/plan";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
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
    applyCommandSettings,
    ensureCommandExists,
    openExistingCommandActionsEditor,
    openCommandSettings,
    readOpenCommandSettings,
} from "./housing";
import {
    commandSettingsMatch,
    desiredCommandSettings,
    type CommandSettings,
} from "./settings";
import { getSessionCommandNamesLower } from "./listCommands";

export type CommandImportPlan = {
    kind: "COMMAND";
    importable: ImportableCommand;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
    settingsHandled: boolean;
    exists: boolean;
};

export type CommandRead = {
    kind: "COMMAND";
    importable: ImportableCommand;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    actions: ActionListSyncScanResult;
    settings: CommandSettings | null;
};

export async function scanImportableCommand(
    ctx: TaskContext,
    importable: ImportableCommand,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<CommandRead> {
    const setup = createSetupStepEmitter(session.actions.events, 1);
    const exists = (await getSessionCommandNamesLower(ctx)).has(
        importable.name.toLowerCase()
    );
    const actions = await scanActionListSync(ctx, {
        desired: importable.actions,
        sync: session.actions,
        trustPlan: exists ? trustPlan : undefined,
        basePath: "actions",
        current: exists ? undefined : { kind: "known-empty" },
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "actions",
        },
        open: async () => {
            await openExistingCommandActionsEditor(ctx, importable.name);
        },
    });

    const settingsTrusted = exists && commandSettingsTrusted(importable, trustPlan);
    let settings: CommandSettings | null = null;
    if (!settingsTrusted) {
        if (exists) await openCommandSettings(ctx, importable.name);
        settings = exists
            ? readOpenCommandSettings(ctx)
            : { mode: "Self", requiredPriority: 0, listed: true };
    }
    setup(exists ? `scanned /${importable.name}` : `/${importable.name} is missing`);
    return { kind: "COMMAND", importable, trustPlan, exists, actions, settings };
}

export async function hydrateImportableCommand(
    ctx: TaskContext,
    read: CommandRead
): Promise<void> {
    if (read.actions.kind !== "hydrate") return;
    read.actions = await hydrateActionListSync(ctx, read.actions);
}

export function planImportableCommand(read: CommandRead): CommandImportPlan {
    return {
        kind: "COMMAND",
        importable: read.importable,
        trustPlan: read.trustPlan,
        actionsPlan: actionListPlanFromRead(read.actions),
        settingsHandled:
            read.settings === null ||
            commandSettingsMatch(
                read.settings,
                desiredCommandSettings(read.importable)
            ),
        exists: read.exists,
    };
}

export async function applyImportableCommandPlan(
    ctx: TaskContext,
    plan: CommandImportPlan,
    session: ImportContext
): Promise<void> {
    if (!plan.exists) {
        await ensureCommandExists(ctx, plan.importable.name);
    }
    if (plan.actionsPlan !== null) {
        await openExistingCommandActionsEditor(ctx, plan.importable.name);
        await applyActionListPlan(ctx, plan.actionsPlan, { sync: session.actions });
    }

    if (!plan.settingsHandled) {
        await openCommandSettings(ctx, plan.importable.name);
        await applyCommandSettings(ctx, plan.importable);
    }
}

export function commandPlanIsNoOp(plan: CommandImportPlan): boolean {
    const actionsNoOp =
        plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
    return plan.exists && actionsNoOp && plan.settingsHandled;
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
