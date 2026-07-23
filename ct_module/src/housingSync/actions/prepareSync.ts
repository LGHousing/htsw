import type { Action } from "htsw/types";

import type { ActionSyncConflict, ActionSyncContext } from "./syncContext";
import type { ImportableTrustPlan } from "../../importCache";
import { readCachedActionList } from "../../importCache/actionLists";
import TaskContext from "../../tasks/context";
import type { ActionListTrust } from "./applyTrust";
import type { ProgressHandler } from "../progress/types";
import type { ProgressScope } from "../syncEvents";
import type { ActionListPath } from "../actionPath";
import {
    createKnownActionListPlan,
    createKnownEmptyActionListPlan,
    hydrateActionListForPlan,
    scanActionListForPlan,
    type ActionListPlanScan,
    type ActionListPlan,
} from "./plan";
import { emitDiffPlanned } from "./apply/progress";
import { emitKnowledgeSource } from "../progress/knowledge";

export type ActionListSyncResult =
    | { kind: "skipped"; reason: "undeclared" | "trusted" }
    | { kind: "planned"; plan: ActionListPlan };

export type ActionListSyncScanResult =
    | ActionListSyncResult
    | {
          kind: "hydrate";
          pending: Extract<ActionListPlanScan, { kind: "hydrate" }>;
          target: ActionListSyncTarget;
      };

export type ActionListSyncTarget = {
    desired: Action[] | undefined;
    basePath: string;
    sync: ActionSyncContext;
    trustPlan?: ImportableTrustPlan;
    open?: () => Promise<void>;
    current?: { kind: "known-empty" } | { kind: "known"; actions: readonly Action[] };
    listPath?: ActionListPath;
    progressScope?: ProgressScope;
    progress?: ProgressHandler;
    conflictTarget?: ActionSyncConflict;
};

export async function readActionListSync(
    ctx: TaskContext,
    target: ActionListSyncTarget
): Promise<ActionListSyncResult> {
    const scan = await scanActionListSync(ctx, target);
    return scan.kind === "hydrate" ? hydrateActionListSync(ctx, scan, false) : scan;
}

export async function scanActionListSync(
    ctx: TaskContext,
    target: ActionListSyncTarget
): Promise<ActionListSyncScanResult> {
    if (target.desired === undefined) {
        return { kind: "skipped", reason: "undeclared" };
    }
    if (target.current?.kind === "known-empty") {
        emitKnowledgeSource(target.sync.events, "known", "known-empty", target.trustPlan);
        return planned(createKnownEmptyActionListPlan(target.desired, target), target);
    }
    if (target.current?.kind === "known") {
        emitKnowledgeSource(target.sync.events, "cache", "cached-list", target.trustPlan);
        return planned(
            createKnownActionListPlan(target.desired, target.current.actions, target),
            target
        );
    }
    if (isActionListTrusted(target.trustPlan, target.basePath)) {
        emitKnowledgeSource(target.sync.events, "cache", "cached-list", target.trustPlan);
        return { kind: "skipped", reason: "trusted" };
    }
    const trustedBaseline = getTrustedBaselineActionList(
        target.trustPlan,
        target.basePath
    );
    const needsConflictScan = conflictScanRequired(target);
    if (trustedBaseline !== undefined && !needsConflictScan) {
        emitKnowledgeSource(target.sync.events, "cache", "cached-list", target.trustPlan);
        return planned(
            createKnownActionListPlan(target.desired, trustedBaseline, target),
            target
        );
    }
    emitKnowledgeSource(
        target.sync.events,
        "house",
        needsConflictScan ? "lock-verification" : "full-read",
        target.trustPlan
    );
    if (target.open !== undefined) {
        await target.open();
    }
    const scan = await scanActionListForPlan(ctx, target.desired, {
        sync: target.sync,
        listPath: target.listPath,
        progressScope: target.progressScope,
        progress: target.progress,
        baselineCurrent: getBaselineActionList(target.trustPlan, target.basePath),
        trustedBaselineAfterUnchangedScan: needsConflictScan
            ? trustedBaseline
            : undefined,
        trust: getActionListTrust(
            target.trustPlan,
            target.basePath,
            target.sync.trustedItemOwners
        ),
        conflictTarget: target.conflictTarget,
    });
    if (needsConflictScan) {
        emitKnowledgeSource(
            target.sync.events,
            "house",
            "lock-verified",
            target.trustPlan
        );
    }
    return scan.kind === "planned"
        ? planned(scan.plan, target)
        : { kind: "hydrate", pending: scan, target };
}

export async function hydrateActionListSync(
    ctx: TaskContext,
    scan: Extract<ActionListSyncScanResult, { kind: "hydrate" }>,
    reopen: boolean = true
): Promise<ActionListSyncResult> {
    if (reopen && scan.target.open !== undefined) {
        await scan.target.open();
    }
    return planned(await hydrateActionListForPlan(ctx, scan.pending), scan.target);
}

export function actionListPlanFromRead(
    read: ActionListSyncScanResult
): ActionListPlan | null {
    if (read.kind === "hydrate") {
        throw new Error("Action-list read was planned before hydration completed.");
    }
    return read.kind === "planned" ? read.plan : null;
}

function conflictScanRequired(target: ActionListSyncTarget): boolean {
    return (
        target.conflictTarget !== undefined &&
        target.sync.trust.trustMode &&
        target.trustPlan?.lockListScanHashes?.[target.basePath] !== undefined
    );
}

// The apply pass re-emits diffPlanned when it starts, but in a two-pass
// session that can be minutes after this Reader finishes (every other
// importable is read in between). Emit as soon as the diff exists so the live
// preview shows the planned operations immediately; the preview's mark
// handlers tolerate the later re-emission.
function planned(
    plan: ActionListPlan,
    target: ActionListSyncTarget
): ActionListSyncResult {
    emitDiffPlanned(target.sync.events, plan.diff, plan.desired, target.listPath);
    return { kind: "planned", plan };
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

function getTrustedBaselineActionList(
    plan: ImportableTrustPlan | undefined,
    basePath: string
): readonly Action[] | undefined {
    if (plan?.trustMode !== true || plan.entry === null) {
        return undefined;
    }
    return readCachedActionList(plan.entry.importable, basePath);
}

function getActionListTrust(
    plan: ImportableTrustPlan | undefined,
    basePath: string,
    trustedItemOwners: ActionListTrust["trustedItemOwners"]
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
        trustedItemOwners,
    };
}
