import { Diagnostic, SourceMap, parseImportablesResult, type ParseResult } from "htsw";
import type { Action, Importable } from "htsw/types";

import { getNestedListFields } from "../importer/fields/actionMappings";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { IMPORT_DEBUG } from "../importer/diagnostics/importDebug";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import {
    buildTrustPlan,
    importableIdentity,
    importableKey,
    tryWriteImportableCache,
} from "../importCache";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
import { resetFunctionNameSession } from "./functions/listFunctions";
import {
    applyImportablePlan,
    prereadImportable,
    type ImportablePlan,
} from "./imports";
import type { ImportEventHandler } from "../importer/importEvents";
import type { ImportableEntry } from "../importer/progress/types";
import { importProgressKey } from "../importer/progress/keys";
import {
    estimateImportableCost,
    setupUnitsForImportable,
} from "../importer/progress/costs";
import type { ImportableCacheEntry } from "../importCache/cache";
import { readCachedActionList } from "./actionListHelpers";

export type ImportSelection = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    parsed?: ParseResult<Importable[]>;
    events?: ImportEventHandler;
};

function toImportDiagnostic(
    error: unknown,
    phase: "read" | "import",
    type: Importable["type"]
): Diagnostic {
    if (error instanceof Diagnostic) return error;
    const verb = phase === "read" ? "read" : "import";
    return Diagnostic.error(`Failed to ${verb} ${type}: ${error}`);
}

export function orderImportablesForImportSession(
    _allImportables: readonly Importable[],
    selectedImportables: readonly Importable[]
): Importable[] {
    // ITEMs are hoisted to the front because action lists reference them
    // by name (GIVE_ITEM, etc.) and need them to exist first. Within each
    // group, original input order is preserved so the queue's display
    // order matches the execution order.
    const items: Importable[] = [];
    const rest: Importable[] = [];
    for (const imp of selectedImportables) {
        if (imp.type === "ITEM") items.push(imp);
        else rest.push(imp);
    }
    return items.concat(rest);
}

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<void> {
    resetFunctionNameSession();

    const parsed = selection.parsed ?? parseImportablesResult(
        new SourceMap(new FileSystemFileLoader()),
        selection.sourcePath
    );
    const sm = new SourceMap(new FileSystemFileLoader());
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const orderedImportables = orderImportablesForImportSession(parsed.value, selection.importables);
    await ctx.sleep(1);
    // Building a trust plan hashes every importable and all of its actions,
    // which is slow. Pass only the ones we're importing this run, not the
    // whole project, so we don't hash things we aren't going to touch.
    const trustPlan = buildTrustPlan(
        selection.housingUuid,
        orderedImportables,
        selection.trustMode
    );

    const events = selection.events;
    const importableUnits: number[] = orderedImportables.map((importable) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(importableKey(importable.type, identity));
        return estimateImportableUnitsFromTrustPlan(importable, tp?.entry ?? null);
    });
    let initialTotalUnits = 0;
    for (let i = 0; i < importableUnits.length; i++) {
        initialTotalUnits += importableUnits[i];
    }
    if (initialTotalUnits === 0) initialTotalUnits = 1;
    const rows: ImportableEntry[] = orderedImportables.map((importable, i) => ({
        key: importProgressKey(
            importable.type,
            importableIdentity(importable),
            selection.sourcePath
        ),
        status: "queued",
        totalUnits: importableUnits[i],
    }));
    events?.emit({ kind: "sessionStarted", rows, initialTotalUnits });

    const rowsMeta = orderedImportables.map((importable, i) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(importableKey(importable.type, identity));
        return {
            importable,
            identity,
            key: importProgressKey(importable.type, identity, selection.sourcePath),
            rowIndex: i,
            trustPlan: tp,
        };
    });
    const plans: Array<{ row: (typeof rowsMeta)[number]; plan: ImportablePlan }> = [];

    // ── Pass 1: pre-read + diff every non-trusted importable. ──────────
    for (let i = 0; i < rowsMeta.length; i++) {
        const row = rowsMeta[i];
        const cacheEntry = row.trustPlan?.entry ?? null;
        events?.emit({
            kind: "importableStarted",
            key: row.key,
            type: row.importable.type,
            identity: row.identity,
            setupUnits: setupUnitsForImportable(row.importable),
            initialUnits: importableUnits[i],
            rowIndex: i,
            cached: cacheEntry === null ? null : cacheEntry.importable,
        });

        if (row.trustPlan?.wholeImportableTrusted) {
            await tryWriteImportableCache(ctx, row.importable, "importer", selection.housingUuid);
            events?.emit({ kind: "importableFinished", key: row.key, status: "skipped" });
            continue;
        }

        try {
            const plan = await prereadImportable(ctx, row.importable, registry, {
                plan: row.trustPlan,
                housingUuid: selection.housingUuid,
                events,
            });
            if (planIsNoOp(plan)) {
                await tryWriteImportableCache(ctx, row.importable, "importer", selection.housingUuid);
                events?.emit({ kind: "importableFinished", key: row.key, status: "imported" });
                continue;
            }
            plans.push({ row, plan });
        } catch (error) {
            if (isTaskCancelled(error)) {
                throw error;
            }
            const diag = toImportDiagnostic(error, "read", row.importable.type);
            events?.emit({ kind: "importableFinished", key: row.key, status: "failed", error: diag.message });
            printDiagnostic(sm, diag);
            if (IMPORT_DEBUG) {
                const stack = error as { stack?: string; rhinoException?: { getScriptStackTrace?: () => string } };
                const trace = stack.rhinoException?.getScriptStackTrace?.() ?? stack.stack;
                if (trace) ctx.displayMessage(`&8[read-stack] ${String(trace).split("\n").slice(0, 8).join(" | ")}`);
            }
            ctx.displayMessage(
                `&c[htsw] Import aborted during pre-read of ${row.importable.type} ${row.identity}; no changes applied.`
            );
            events?.emit({ kind: "sessionFinished" });
            return;
        }
    }

    // ── Pass 2: apply every collected plan in original order. ──────────
    for (const { row, plan } of plans) {
        events?.emit({
            kind: "importableReactivated",
            key: row.key,
            rowIndex: row.rowIndex,
        });
        try {
            await applyImportablePlan(ctx, plan, registry, {
                plan: row.trustPlan,
                housingUuid: selection.housingUuid,
                events,
            });
            // ITEM manages its own per-NBT cache during apply.
            if (plan.kind !== "ITEM") {
                await tryWriteImportableCache(
                    ctx,
                    row.importable,
                    "importer",
                    selection.housingUuid
                );
            }
            events?.emit({ kind: "importableFinished", key: row.key, status: "imported" });
        } catch (error) {
            await maybeWritePartialImportCache(ctx, plan, selection.housingUuid);
            if (isTaskCancelled(error)) {
                throw error;
            }
            const diag = toImportDiagnostic(error, "import", row.importable.type);
            events?.emit({ kind: "importableFinished", key: row.key, status: "failed", error: diag.message });
            printDiagnostic(sm, diag);
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${row.importable.type} ${row.identity}`
            );
            break;
        }
    }

    events?.emit({ kind: "sessionFinished" });
}

/** Cache the partially-applied state after a failed or cancelled apply. */
async function maybeWritePartialImportCache(
    ctx: TaskContext,
    plan: ImportablePlan,
    housingUuid: string
): Promise<void> {
    const partial = reconstructPartialImportable(plan);
    if (partial === null) return;
    await tryWriteImportableCache(ctx, partial, "importer", housingUuid);
}

/**
 * Rebuild the importable from the live snapshot, or null when it isn't safely
 * persistable: a shallow snapshot (un-hydrated nested lists hold nulls) would
 * cache a half-known list as truth. FUNCTION/EVENT only; icon/ticks are dropped
 * so a retry re-applies settings instead of trusting maybe-unwritten values.
 */
function reconstructPartialImportable(plan: ImportablePlan): Importable | null {
    if (plan.kind !== "FUNCTION" && plan.kind !== "EVENT") return null;
    const live = plan.actionsPlan?.getLiveCurrent?.();
    if (live === undefined || !actionsFullyKnown(live)) return null;
    const actions = live as Action[];
    if (plan.kind === "FUNCTION") {
        return { type: "FUNCTION", name: plan.importable.name, actions };
    }
    return { type: "EVENT", event: plan.importable.event, actions };
}

function actionsFullyKnown(actions: ReadonlyArray<Action | null>): boolean {
    for (const action of actions) {
        if (action === null) return false;
        for (const field of getNestedListFields(action.type)) {
            const nested = (action as Record<string, unknown>)[field.prop];
            if (!Array.isArray(nested)) continue;
            if (field.prop === "conditions") {
                for (const condition of nested) {
                    if (condition === null) return false;
                }
            } else if (!actionsFullyKnown(nested as Array<Action | null>)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * True when applying this plan would change nothing, so the importable can be
 * marked done right after the read pass and skip the apply pass entirely.
 *
 * Only EVENT and FUNCTION can be judged this early, because all their apply
 * work is the action diff we already computed during the read. FUNCTION also
 * has an icon and repeat-ticks; `settingsHandled` tells us those are already
 * done (the read applies them when there were no action changes). REGION, MENU
 * and ITEM always have real work left in the apply pass, so never no-ops here.
 */
function planIsNoOp(plan: ImportablePlan): boolean {
    if (plan.kind === "EVENT") {
        return plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
    }
    if (plan.kind === "FUNCTION") {
        const actionsNoOp =
            plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
        return actionsNoOp && plan.settingsHandled;
    }
    return false;
}

function estimateImportableUnitsFromTrustPlan(
    importable: Importable,
    entry: ImportableCacheEntry | null
): number {
    if (entry === null) {
        return Math.max(1, estimateImportableCost(importable));
    }
    const getCached = (basePath: string) =>
        readCachedActionList(entry.importable, basePath);
    return Math.max(1, estimateImportableCost(importable, getCached));
}
