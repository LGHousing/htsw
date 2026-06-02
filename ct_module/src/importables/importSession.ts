import { Diagnostic, SourceMap, parseImportablesResult, type ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { IMPORT_DEBUG } from "../importer/diagnostics/importDebug";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import {
    buildTrustPlan,
    getCurrentHousingUuid,
    importableIdentity,
    importableKey,
    writeImportableCache,
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

/**
 * Normalise any thrown import failure into a single Diagnostic — the one error
 * currency. Already-a-Diagnostic passes through (keeps spans, if any); a plain
 * Error/value becomes a span-less `Diagnostic.error`. Both render uniformly via
 * `printDiagnostic` (chat) and expose `.message` (GUI failure banner).
 */
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
    // Fresh per import: the /functions list (names + current icons) is cached
    // for the run, so a stale cache from a prior import must not leak in.
    resetFunctionNameSession();

    const parsed = selection.parsed ?? parseImportablesResult(
        new SourceMap(new FileSystemFileLoader()),
        selection.sourcePath
    );
    const sm = new SourceMap(new FileSystemFileLoader());
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const ordered = orderImportablesForImportSession(parsed.value, selection.importables);
    await ctx.sleep(1);
    // Only the selected importables' trust plans are ever consulted, and each
    // plan costs an importableHash + a full listHashes (per-action). Scoping to
    // `ordered` avoids hashing the entire project when importing a subset.
    const trustPlan = buildTrustPlan(
        selection.housingUuid,
        ordered,
        selection.trustMode
    );

    const events = selection.events;
    const importableUnits: number[] = ordered.map((importable) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(importableKey(importable.type, identity));
        return estimateImportableUnitsFromTrustPlan(importable, tp?.entry ?? null);
    });
    let initialTotalUnits = 0;
    for (let i = 0; i < importableUnits.length; i++) {
        initialTotalUnits += importableUnits[i];
    }
    if (initialTotalUnits === 0) initialTotalUnits = 1;
    const rows: ImportableEntry[] = ordered.map((importable, i) => ({
        key: importProgressKey(
            importable.type,
            importableIdentity(importable),
            selection.sourcePath
        ),
        status: "queued",
        totalUnits: importableUnits[i],
    }));
    events?.emit({ kind: "sessionStarted", rows, initialTotalUnits });

    const rowsMeta = ordered.map((importable, i) => {
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
            await maybeWriteImportCacheForTrust(ctx, row.importable, selection.housingUuid);
            events?.emit({ kind: "importableFinished", key: row.key, status: "skipped" });
            continue;
        }

        try {
            const plan = await prereadImportable(ctx, row.importable, registry, {
                plan: row.trustPlan,
                housingUuid: selection.housingUuid,
                events,
            });
            // If hydration proved this importable needs no changes, mark it
            // green now and skip the apply pass — there's nothing to do.
            if (planIsNoOp(plan)) {
                await maybeWriteImportCacheForTrust(ctx, row.importable, selection.housingUuid);
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
            events?.emit({ kind: "importableFinished", key: row.key, status: "imported" });
        } catch (error) {
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

async function maybeWriteImportCacheForTrust(
    ctx: TaskContext,
    importable: Importable,
    cachedUuid?: string
): Promise<void> {
    try {
        const housingUuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
        writeImportableCache(ctx, housingUuid, importable, "importer");
    } catch (error) {
        if (IMPORT_DEBUG) {
            ctx.displayMessage(
                `&7[knowledge] &eSkipped cache write for trusted ${importable.type}: ${error}`
            );
        }
    }
}

/**
 * True when a hydrated plan's apply pass would make zero changes, so the
 * importable can be marked imported right after pass 1 and skip pass 2.
 *
 * Only EVENT and FUNCTION are provable from the preread: their plans carry
 * the full action diff and have no separate apply-time work beyond it.
 * FUNCTION's extra work — icon/repeatTicks — is captured by the plan's
 * `settingsHandled` flag: when the action diff was empty the preread already
 * applied the settings inline, so there's nothing left for pass 2. REGION
 * always re-applies its bounds (TP + //pos + Move Region) regardless of the
 * diff, and MENU/ITEM defer all work to the apply pass, so none of those can
 * be proven no-op here.
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
