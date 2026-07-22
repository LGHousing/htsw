import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";
import type { Importable, ImportableItem } from "htsw/types";

import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { isTaskTraceEnabled, traceNote } from "../../housingSync/trace/taskTrace";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { buildTrustPlan, tryWriteImportableCache } from "../../importCache";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import { importableIdentity, importableKey } from "../identity";
import { createProjectItemIndex } from "../items/projectItems";
import { createItemDependencyIndex } from "../items/dependencyIndex";
import { createItemDiffContext } from "../items/diff";
import { createItemFieldResolver } from "../items/resolveItem";
import { createItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { resetFunctionNameSession } from "../functions/listFunctions";
import { resetMenuNameSession } from "../menus/listMenus";
import { resetCommandNameSession } from "../commands/listCommands";
import { createNpcLookupCache } from "../npcs/listNpcs";
import {
    scanImportable,
    type ImportablePlan,
    type ImportableRead,
} from "./importers";
import type { ImportContext } from "./context";
import {
    expandDeclaredTeamAndGroupDependencies,
    expandClickActionItemDependencies,
    referencedItemNames,
} from "../items/dependencies";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import type { TaskProgressEntry } from "../../housingSync/progress/types";
import { queueRowKey } from "../../housingSync/progress/queueRowKey";
import {
    estimateImportableUnits,
    setupUnitsForImportable,
} from "../../housingSync/progress/costs";
import {
    actionListApplyResultFromError,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import { writeImportFailureLog } from "../../runtimeDebug/importFailureLog";
import { resetRuntimeDebugRecords } from "../../runtimeDebug/runtimeDebugBuffer";
import type { ImportConflict } from "./conflicts";
import {
    applyReferencedShellPlan,
    planMissingReferencedShells,
} from "./references";

export type ImportSessionRequest = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    parsed?: ImportablesParseResult;
    events?: SyncEventHandler;
    confirmConflicts?: (conflicts: readonly ImportConflict[]) => Promise<boolean>;
    /**
     * Called for each click-action item dependency the session adds beyond
     * `importables`. Expansion needs the housing UUID, so it can only run
     * here, after the caller's queue snapshot — this hands the additions
     * back so the visible queue can stay in sync with the actual work set.
     */
    onImportableAutoAdded?: (importable: Importable) => void;
};

function toImportDiagnostic(
    error: unknown,
    phase: "read" | "import",
    type: Importable["type"]
): Diagnostic {
    if (error instanceof Diagnostic) return error;
    const verb = phase === "read" ? "read" : "import";
    const message = error instanceof Error ? error.message : String(error);
    return Diagnostic.error(`Failed to ${verb} ${type}: ${message}`);
}

export function orderImportablesForSession(
    _allImportables: readonly Importable[],
    selectedImportables: readonly Importable[]
): Importable[] {
    const prerequisites: Importable[] = [];
    const selectedItems: ImportableItem[] = [];
    const rest: Importable[] = [];
    for (const imp of selectedImportables) {
        if (imp.type === "TEAM" || imp.type === "GROUP") prerequisites.push(imp);
        else if (imp.type === "ITEM") selectedItems.push(imp);
        else rest.push(imp);
    }

    const itemsByName = new Map<string, ImportableItem>();
    for (const item of selectedItems) itemsByName.set(item.name, item);

    const orderedItems: Importable[] = [];
    const state = new Map<string, "visiting" | "done">();

    function visit(item: ImportableItem): void {
        const current = state.get(item.name);
        if (current === "done") return;
        if (current === "visiting") return;

        state.set(item.name, "visiting");
        for (const name of referencedItemNames(item)) {
            const dependency = itemsByName.get(name);
            if (dependency !== undefined) visit(dependency);
        }
        state.set(item.name, "done");
        orderedItems.push(item);
    }

    for (const item of selectedItems) visit(item);
    return prerequisites.concat(orderedItems, rest);
}

export async function runImportSession(
    ctx: TaskContext,
    selection: ImportSessionRequest
): Promise<void> {
    resetRuntimeDebugRecords();
    resetFunctionNameSession();
    resetMenuNameSession();
    resetCommandNameSession();

    const parsed =
        selection.parsed ??
        parseImportablesResult(
            new SourceMap(new FileSystemFileLoader()),
            selection.sourcePath
        );
    const items = createProjectItemIndex(parsed.value, parsed.gcx);
    const itemDependencies = createItemDependencyIndex(parsed.value, items);
    if (itemDependencies.cycles.length > 0) {
        throw Diagnostic.error(
            `Item click actions form a cycle: ${itemDependencies.cycles[0].itemNames.join(" -> ")}`
        );
    }

    const teamGroupExpansion = expandDeclaredTeamAndGroupDependencies(
        parsed.value,
        selection.importables
    );
    for (const team of teamGroupExpansion.addedTeams) {
        selection.onImportableAutoAdded?.(team);
        ctx.displayMessage(
            `&7[htsw] Also importing team '&f${team.name}&7' — it is referenced by this import.`
        );
    }
    for (const group of teamGroupExpansion.addedGroups) {
        selection.onImportableAutoAdded?.(group);
        ctx.displayMessage(
            `&7[htsw] Also importing group '&f${group.name}&7' — it is referenced by this import.`
        );
    }

    const expansion = expandClickActionItemDependencies(
        items,
        itemDependencies,
        teamGroupExpansion.importables,
        selection.housingUuid
    );
    for (const item of expansion.addedItems) {
        selection.onImportableAutoAdded?.(item);
        ctx.displayMessage(
            `&7[htsw] Also importing item '&f${item.name}&7' — it has click actions and isn't in this house yet.`
        );
    }

    const orderedImportables = orderImportablesForSession(
        parsed.value,
        expansion.importables
    );
    await ctx.sleep(1);
    // Building a trust plan hashes every importable and all of its actions,
    // which is slow. Pass only the ones we're importing this run, not the
    // whole project, so we don't hash things we aren't going to touch.
    const trustPlan = buildTrustPlan(
        selection.housingUuid,
        orderedImportables,
        selection.trustMode,
        selection.sourcePath,
        itemDependencies
    );

    const itemFieldObservations = selection.trustMode
        ? undefined
        : createItemFieldObservationRecorder();
    const itemDiff = createItemDiffContext(
        orderedImportables,
        itemDependencies,
        items,
        selection.housingUuid,
        (importable) => {
            const identity = importableIdentity(importable);
            const entry = trustPlan.importables.get(
                importableKey(importable.type, identity)
            )?.entry;
            return entry?.itemDependencies;
        },
        itemFieldObservations
    );

    const events = selection.events;
    const session: ImportContext = {
        parsed,
        items,
        housingUuid: selection.housingUuid,
        itemDependencies,
        npcLookup: createNpcLookupCache(),
        actions: {
            canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
            resolveItem: createItemFieldResolver(
                items,
                itemDependencies,
                selection.housingUuid
            ),
            trust: trustPlan,
            conflicts: [],
            events,
            itemRead: { mode: "sync" },
            itemDiff,
            itemFieldObservations,
        },
    };
    const rowsMeta = orderedImportables.map((importable, rowIndex) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(importableKey(importable.type, identity));
        return {
            importable,
            identity,
            key: queueRowKey(importable.type, identity, selection.sourcePath),
            rowIndex,
            trustPlan: tp,
            units: estimateImportableUnits(
                importable,
                tp?.entry ?? null,
                tp?.trustMode === true
            ),
        };
    });

    const rows: TaskProgressEntry[] = rowsMeta.map((row) => ({
        key: row.key,
        status: "queued",
        totalUnits: row.units,
    }));
    let initialTotalUnits = 0;
    for (const row of rowsMeta) initialTotalUnits += row.units;
    if (initialTotalUnits === 0) initialTotalUnits = 1;
    events?.emit({ kind: "sessionStarted", rows, initialTotalUnits });

    const referencedShellPlan = await planMissingReferencedShells(
        ctx,
        orderedImportables
    );

    const plans: Array<{ row: (typeof rowsMeta)[number]; plan: ImportablePlan }> = [];
    const noOpRows: (typeof rowsMeta)[number][] = [];
    const trustedRows: (typeof rowsMeta)[number][] = [];
    const reads: Array<{ row: (typeof rowsMeta)[number]; read: ImportableRead }> = [];

    // ── Pass 1: scan every non-trusted importable. ─────────────────────
    for (let i = 0; i < rowsMeta.length; i++) {
        const row = rowsMeta[i];
        const cacheEntry = row.trustPlan?.entry ?? null;
        events?.emit({
            kind: "importableStarted",
            key: row.key,
            type: row.importable.type,
            identity: row.identity,
            setupUnits: setupUnitsForImportable(row.importable),
            initialUnits: row.units,
            rowIndex: row.rowIndex,
            cached: cacheEntry === null ? null : cacheEntry.importable,
        });

        // A trusted ITEM still has work to do: the item itself must land in
        // the player's inventory (its apply spawns from the SNBT cache).
        if (row.trustPlan?.wholeImportableTrusted && row.importable.type !== "ITEM") {
            trustedRows.push(row);
            continue;
        }

        try {
            reads.push({
                row,
                read: await scanImportable(ctx, row.importable, session),
            });
        } catch (error) {
            await writeObservedPlanCaches(
                ctx,
                plans,
                selection.sourcePath,
                selection.housingUuid
            );
            if (isTaskCancelled(error)) {
                throw error;
            }
            const diag = toImportDiagnostic(error, "read", row.importable.type);
            events?.emit({
                kind: "importableFinished",
                key: row.key,
                status: "failed",
                error: diag.message,
            });
            const logPath = writeImportFailureLog(
                {
                    phase: "scan",
                    sourcePath: selection.sourcePath,
                    housingUuid: selection.housingUuid,
                    importableType: row.importable.type,
                    identity: row.identity,
                    rowIndex: row.rowIndex,
                },
                error
            );
            if (isTaskTraceEnabled()) {
                const stack = error as {
                    stack?: string;
                    rhinoException?: { getScriptStackTrace?: () => string };
                };
                const trace =
                    stack.rhinoException?.getScriptStackTrace?.() ?? stack.stack;
                if (trace)
                    traceNote("read-stack", trace.split("\n").slice(0, 8).join(" | "));
            }
            ctx.displayMessage(
                `&c[htsw] Import aborted while scanning ${row.importable.type} ${row.identity}; no changes applied.`
            );
            ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
            events?.emit({ kind: "sessionFinished" });
            return;
        }
    }

    // ── Pass 2: hydrate every typed scan before planning any writes. ────
    const hydrated: typeof reads = [];
    for (const entry of reads) {
        try {
            await entry.read.hydrate(ctx);
            hydrated.push(entry);
        } catch (error) {
            const observedPlans = hydrated.map(({ read }) => ({
                plan: read.plan(session),
            }));
            await writeObservedPlanCaches(
                ctx,
                observedPlans,
                selection.sourcePath,
                selection.housingUuid
            );
            if (isTaskCancelled(error)) throw error;
            const row = entry.row;
            const diag = toImportDiagnostic(error, "read", row.importable.type);
            events?.emit({
                kind: "importableFinished",
                key: row.key,
                status: "failed",
                error: diag.message,
            });
            const logPath = writeImportFailureLog(
                {
                    phase: "hydrate",
                    sourcePath: selection.sourcePath,
                    housingUuid: selection.housingUuid,
                    importableType: row.importable.type,
                    identity: row.identity,
                    rowIndex: row.rowIndex,
                },
                error
            );
            ctx.displayMessage(
                `&c[htsw] Import aborted while hydrating ${row.importable.type} ${row.identity}; no changes applied.`
            );
            ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
            events?.emit({ kind: "sessionFinished" });
            return;
        }
    }

    // ── Pass 3: convert complete observations into exact apply plans. ───
    for (const { row, read } of reads) {
        const plan = read.plan(session);
        if (plan.isNoOp()) {
            noOpRows.push(row);
        } else {
            plans.push({ row, plan });
        }
    }

    if (session.actions.conflicts.length > 0) {
        const proceed =
            selection.confirmConflicts === undefined
                ? true
                : await selection.confirmConflicts(session.actions.conflicts);
        if (!proceed) {
            for (const row of rowsMeta) {
                events?.emit({
                    kind: "importableFinished",
                    key: row.key,
                    status: "skipped",
                });
            }
            ctx.displayMessage(
                "&c[htsw] Import cancelled — Housing changed since the last import."
            );
            ctx.displayMessage(
                "&7[htsw] Review the conflicting action lists in Housing, then retry."
            );
            events?.emit({ kind: "sessionFinished" });
            return;
        }
    }

    await applyReferencedShellPlan(ctx, referencedShellPlan, (kind, name) => {
        ctx.displayMessage(`&7[htsw] Created referenced ${kind} '&f${name}&7'.`);
    });

    for (const row of trustedRows) {
        events?.emit({
            kind: "importableReactivated",
            key: row.key,
            rowIndex: row.rowIndex,
        });
        await finishWithoutApply(
            ctx,
            row,
            "skipped",
            selection,
            itemDependencies,
            events
        );
    }

    for (const row of noOpRows) {
        events?.emit({
            kind: "importableReactivated",
            key: row.key,
            rowIndex: row.rowIndex,
        });
        await finishWithoutApply(
            ctx,
            row,
            "imported",
            selection,
            itemDependencies,
            events
        );
    }

    // ── Pass 4: apply every collected plan in original order. ──────────
    for (let planIndex = 0; planIndex < plans.length; planIndex++) {
        const { row, plan } = plans[planIndex];
        events?.emit({
            kind: "importableReactivated",
            key: row.key,
            rowIndex: row.rowIndex,
        });
        try {
            await plan.apply(ctx, session);
            // ITEM manages its own per-NBT cache during apply.
            if (plan.kind !== "ITEM") {
                await tryWriteImportableCache(
                    ctx,
                    row.importable,
                    "importer",
                    selection.housingUuid,
                    { itemDependencies: itemDependencies.snapshotOf(row.importable) }
                );
            }
            upsertHouseLockImportable(
                selection.sourcePath,
                selection.housingUuid,
                row.importable,
                itemDependencies.snapshotOf(row.importable)
            );
            events?.emit({
                kind: "importableFinished",
                key: row.key,
                status: "imported",
            });
        } catch (error) {
            await maybeWritePartialImportCache(
                ctx,
                plan,
                selection.sourcePath,
                selection.housingUuid,
                actionListApplyResultFromError(error)
            );
            await writeObservedPlanCaches(
                ctx,
                plans.slice(planIndex + 1),
                selection.sourcePath,
                selection.housingUuid
            );
            if (isTaskCancelled(error)) {
                throw error;
            }
            const diag = toImportDiagnostic(error, "import", row.importable.type);
            events?.emit({
                kind: "importableFinished",
                key: row.key,
                status: "failed",
                error: diag.message,
            });
            const logPath = writeImportFailureLog(
                {
                    phase: "apply",
                    sourcePath: selection.sourcePath,
                    housingUuid: selection.housingUuid,
                    importableType: row.importable.type,
                    identity: row.identity,
                    rowIndex: row.rowIndex,
                },
                error
            );
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${row.importable.type} ${row.identity}`
            );
            ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
            break;
        }
    }

    events?.emit({ kind: "sessionFinished" });
}

async function finishWithoutApply(
    ctx: TaskContext,
    row: {
        importable: Importable;
        key: string;
    },
    status: "imported" | "skipped",
    selection: ImportSessionRequest,
    itemDependencies: ReturnType<typeof createItemDependencyIndex>,
    events: SyncEventHandler | undefined
): Promise<void> {
    const dependencies = itemDependencies.snapshotOf(row.importable);
    await tryWriteImportableCache(
        ctx,
        row.importable,
        "importer",
        selection.housingUuid,
        { itemDependencies: dependencies }
    );
    upsertHouseLockImportable(
        selection.sourcePath,
        selection.housingUuid,
        row.importable,
        dependencies
    );
    events?.emit({ kind: "importableFinished", key: row.key, status });
}

/** Cache the partially-applied state after a failed or cancelled apply. */
async function maybeWritePartialImportCache(
    ctx: TaskContext,
    plan: ImportablePlan,
    sourcePath: string,
    housingUuid: string,
    result: ActionListApplyResult | null
): Promise<void> {
    const partial = plan.reconstructPartial(result);
    if (partial === null) return;
    await tryWriteImportableCache(ctx, partial, "importer", housingUuid);
    upsertHouseLockImportable(sourcePath, housingUuid, partial);
}

/**
 * An aborted session drops its remaining plans, but each plan's Reader
 * already walked the house menus. Persist what was observed so the retry can
 * trust unchanged action lists instead of re-reading them. The house lock
 * entry must be written too — without it the next run's trust plan discards
 * the cache entry as untraceable (`cacheMatchesLock`).
 */
async function writeObservedPlanCaches(
    ctx: TaskContext,
    plans: ReadonlyArray<{ plan: ImportablePlan }>,
    sourcePath: string,
    housingUuid: string
): Promise<void> {
    for (const { plan } of plans) {
        const observed = plan.reconstructObserved();
        if (observed === null) continue;
        await tryWriteImportableCache(ctx, observed, "importer", housingUuid);
        upsertHouseLockImportable(sourcePath, housingUuid, observed);
    }
}
