import type { Action } from "htsw/types";

import {
    prereadActionList,
    type ActionListPlan,
    type ActionListPrereadOptions,
} from "../housingSync/actions/plan";
import type { ActionListTrust } from "../housingSync/types";
import type { ImportableTrustPlan } from "../importCache";
import { readCachedActionList } from "../importCache/actionLists";
import TaskContext from "../tasks/context";

export function getBaselineActionList(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): readonly Action[] | undefined {
    if (plan === undefined || plan.entry === null) {
        return undefined;
    }
    return readCachedActionList(plan.entry.importable, basePath);
}

function getTrustedBaselineActionList(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): readonly Action[] | undefined {
    if (
        plan === undefined ||
        plan.entry === null ||
        !plan.trustMode ||
        !plan.trustedListPaths.has(basePath)
    ) {
        return undefined;
    }
    return readCachedActionList(plan.entry.importable, basePath) ?? [];
}

export function hasTrustedActionListBaseline(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): boolean {
    return getTrustedBaselineActionList(plan, basePath) !== undefined;
}

export function getActionListTrust(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): ActionListTrust | undefined {
    if (
        plan === undefined ||
        plan.entry === null ||
        plan.trustedListPaths.size === 0
    ) {
        return undefined;
    }
    return { basePath, trustedListPaths: plan.trustedListPaths };
}

export async function prereadActionListUsingTrust(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions & {
        trustPlan?: ImportableTrustPlan;
        basePath: string;
    }
): Promise<ActionListPlan> {
    const { trustPlan, basePath, ...readOptions } = options;
    const trustedBaseline = getTrustedBaselineActionList(trustPlan, basePath);
    if (trustedBaseline !== undefined) {
        return await prereadActionList(ctx, desired, {
            ...readOptions,
            observed: observedActionSlotsFromActions(trustedBaseline),
        });
    }

    return await prereadActionList(ctx, desired, {
        ...readOptions,
        baselineCurrent: options.baselineCurrent ?? getBaselineActionList(trustPlan, basePath),
        trust: options.trust ?? getActionListTrust(trustPlan, basePath),
    });
}

function observedActionSlotsFromActions(actions: readonly Action[]) {
    return actions.map((action, index) => ({
        index,
        action: JSON.parse(JSON.stringify(action)) as Action,
        nestedReadState: "full" as const,
    }));
}
