import type { Action } from "htsw/types";

import type { ImportSession } from "../../importables/imports";
import type { ImportableTrustPlan } from "../../importCache";
import { readCachedActionList } from "../../importCache/actionLists";
import TaskContext from "../../tasks/context";
import type { ActionListTrust } from "../types";
import type { ActionPath, ProgressScope } from "../importEvents";
import {
    createKnownEmptyActionListPlan,
    prereadActionList,
    type ActionListPlan,
} from "./plan";

export type ActionListSyncResult =
    | { kind: "skipped"; reason: "undeclared" | "trusted" }
    | { kind: "planned"; plan: ActionListPlan };

export type ActionListSyncTarget = {
    desired: Action[] | undefined;
    basePath: string;
    session: ImportSession;
    trustPlan?: ImportableTrustPlan;
    open?: () => Promise<void>;
    current?: { kind: "known-empty" };
    listPath?: ActionPath;
    progressScope?: ProgressScope;
};

export function shouldSyncActionList(
    desired: Action[] | undefined,
    trustPlan: ImportableTrustPlan | undefined,
    basePath: string
): boolean {
    return desired !== undefined && !isActionListTrusted(trustPlan, basePath);
}

export async function prepareActionListSync(
    ctx: TaskContext,
    target: ActionListSyncTarget
): Promise<ActionListSyncResult> {
    if (target.desired === undefined) {
        return { kind: "skipped", reason: "undeclared" };
    }
    if (isActionListTrusted(target.trustPlan, target.basePath)) {
        return { kind: "skipped", reason: "trusted" };
    }
    if (target.current?.kind === "known-empty") {
        return {
            kind: "planned",
            plan: createKnownEmptyActionListPlan(target.desired, target),
        };
    }
    if (target.open !== undefined) {
        await target.open();
    }
    return {
        kind: "planned",
        plan: await prereadActionList(ctx, target.desired, {
            session: target.session,
            listPath: target.listPath,
            progressScope: target.progressScope,
            baselineCurrent: getBaselineActionList(
                target.trustPlan,
                target.basePath
            ),
            trust: getActionListTrust(target.trustPlan, target.basePath),
        }),
    };
}

function isActionListTrusted(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): boolean {
    return plan?.trustedChildListPaths.has(basePath) ?? false;
}

function getBaselineActionList(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): readonly Action[] | undefined {
    if (plan === undefined || plan.entry === null) {
        return undefined;
    }
    return readCachedActionList(plan.entry.importable, basePath);
}

function getActionListTrust(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): ActionListTrust | undefined {
    if (
        plan === undefined ||
        plan.entry === null ||
        plan.trustedChildListPaths.size === 0
    ) {
        return undefined;
    }
    return {
        basePath,
        trustedChildListPaths: plan.trustedChildListPaths,
        trustedChildLists: plan.trustedChildLists,
    };
}
