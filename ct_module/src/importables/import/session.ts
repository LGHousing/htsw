import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";
import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { isTaskTraceEnabled, traceNote } from "../../housingSync/trace/taskTrace";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import {
    buildTrustPlan,
    deleteImportableCache,
    loadImportableCachesOffThread,
    tryWriteImportableCache,
    type ImportableCacheLoadRequest,
} from "../../importCache";
import {
    upsertHouseLockImportablesOffThread,
    type HouseLockImportableUpdate,
} from "../../importCache/houseLock";
import { warmImportableHashesOffThread } from "../../importCache/hashMemo";
import { importableIdentity, importableKey } from "../identity";
import {
    type ItemDependencyIndex,
    type ItemDependencySnapshot,
} from "../items/dependencyIndex";
import { createItemDiffContext } from "../items/diff";
import {
    createItemVerificationTracker,
    verifiedItemDependencies,
    type ItemVerificationTracker,
} from "../items/verifiedDependencies";
import type { ItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import type { ProjectItemIndex } from "../items/projectItems";
import { createItemFieldResolver } from "../items/resolveItem";
import { createItemFieldObservationRecorder } from "../../housingSync/items/fieldObservations";
import { resetFunctionNameSession } from "../functions/listFunctions";
import { resetMenuNameSession } from "../menus/listMenus";
import { resetCommandNameSession } from "../commands/listCommands";
import { createNpcLookupCache } from "../npcs/listNpcs";
import { scanImportable, type ImportablePlan, type ImportableRead } from "./importers";
import type { ImportContext } from "./context";
import { expandImportDependencies } from "./dependencyExpansion";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import type { TaskProgressEntry } from "../../housingSync/progress/types";
import { queueRowKey } from "../../housingSync/progress/queueRowKey";
import {
    COST,
    estimateImportableUnits,
    setupUnitsForImportable,
} from "../../housingSync/progress/costs";
import { emitKnowledgeSource } from "../../housingSync/progress/knowledge";
import {
    actionListApplyResultFromError,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import { writeTaskFailureLog } from "../../runtimeDebug/importFailureLog";
import { resetRuntimeDebugRecords } from "../../runtimeDebug/runtimeDebugBuffer";
import type { ImportConflict } from "./conflicts";
import {
    applyReferencedShellPlan,
    planMissingReferencedShells,
    referencedShellApplicationUnits,
    referencedShellPlanApplicationUnits,
} from "./references";
import { createImportedItemPlacementSession } from "../../housingSync/items/heldItem";
import { recordEmptyFunctionShell } from "./emptyShells";
import { readInteractDataCache } from "../items/interactDataCache";
import { getOverwriteWarningMode, type OverwriteWarningMode } from "../overwriteWarning";
import {
    ApplicationProgress,
    defineApplicationPlan,
    type ApplicationPlan,
    workStep,
} from "./applicationProgress";
import {
    sourceItemFieldContent,
    type ItemFieldContent,
} from "../../housingSync/items/fieldContent";

export { orderImportablesForSession } from "./dependencyExpansion";

export type ImportSessionRequest = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    overwriteWarningMode?: OverwriteWarningMode;
    parsed?: ImportablesParseResult;
    events?: SyncEventHandler;
    conflictHandling:
        | { kind: "proceed" }
        | {
              kind: "prompt";
              decide: (conflicts: readonly ImportConflict[]) => Promise<boolean>;
          };
    /** Called for dependencies that were not already included by the caller. */
    onImportableAutoAdded?: (importable: Importable) => void;
};

type PendingHouseLockEntries = Map<string, HouseLockImportableUpdate>;

const SCAN_HYDRATE_CHUNK_SIZE = 25;

type VerifiedDependencyContext = {
    dependencies: ItemDependencyIndex;
    projectItems: ProjectItemIndex;
    housingUuid: string;
    tracker: ItemVerificationTracker;
    observations: ItemFieldObservationRecorder | undefined;
    itemContent: ItemFieldContent | undefined;
    trustPlan: ReturnType<typeof buildTrustPlan>;
    trustedItemOwners: WeakSet<Action | Condition>;
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

function warmImportableCaches(
    housingUuid: string,
    importables: readonly Importable[]
): Promise<void> {
    const requests: ImportableCacheLoadRequest[] = [];
    for (const importable of importables) {
        requests.push({
            housingUuid,
            type: importable.type,
            identity: importableIdentity(importable),
        });
    }
    return new Promise((resolve) => {
        let remaining = 2;
        const completeOne = () => {
            remaining--;
            if (remaining === 0) resolve();
        };
        loadImportableCachesOffThread(requests, completeOne);
        warmImportableHashesOffThread(importables, completeOne);
    });
}

export async function runImportSession(
    ctx: TaskContext,
    selection: ImportSessionRequest
): Promise<void> {
    try {
        await runImportSessionInner(ctx, selection);
    } catch (error) {
        if (isTaskCancelled(error)) {
            reportCancellationCache(ctx, error, {
                savedCount: 0,
                lockUpdated: true,
                invalidatedCurrent: false,
                invalidationFailed: false,
            });
        }
        throw error;
    }
}

async function runImportSessionInner(
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
    const expansion = expandImportDependencies(
        parsed,
        selection.importables,
        selection.housingUuid,
        {
            trustMode: selection.trustMode,
            importJsonPath: selection.sourcePath,
        }
    );
    const { items, itemDependencies } = expansion;
    if (itemDependencies.cycles.length > 0) {
        throw Diagnostic.error(
            `Item click actions form a cycle: ${itemDependencies.cycles[0].itemNames.join(" -> ")}`
        );
    }

    for (const importable of expansion.addedImportables) {
        selection.onImportableAutoAdded?.(importable);
        if (importable.type === "TEAM" || importable.type === "GROUP") {
            ctx.displayMessage(
                `&7[htsw] Also importing ${importable.type.toLowerCase()} '&f${importable.name}&7' — it is referenced by this import.`
            );
        }
    }
    if (expansion.addedItems.length > 0) {
        const count = expansion.addedItems.length;
        ctx.displayMessage(
            `&7[htsw] Also importing &f${count}&7 required click-action item${count === 1 ? "" : "s"} — house item data is not cached.`
        );
    }

    const orderedImportables = expansion.importables;
    await warmImportableCaches(selection.housingUuid, orderedImportables);
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
    const itemVerification = createItemVerificationTracker();
    const trustedItemOwners = new WeakSet<Action | Condition>();
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
        itemFieldObservations,
        itemVerification
    );

    const referencedShellPlan = await planMissingReferencedShells(
        ctx,
        orderedImportables
    );
    const events = selection.events;
    const session: ImportContext = {
        parsed,
        items,
        housingUuid: selection.housingUuid,
        itemDependencies,
        itemPlacement: createImportedItemPlacementSession(),
        npcLookup: createNpcLookupCache(),
        actions: {
            canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
            resolveItem: createItemFieldResolver(
                items,
                itemDependencies,
                selection.housingUuid
            ),
            trust: trustPlan,
            overwriteWarningMode:
                selection.overwriteWarningMode ?? getOverwriteWarningMode(),
            conflicts: [],
            events,
            itemRead: { mode: "sync" },
            itemDiff,
            itemFieldObservations,
            trustedItemOwners,
        },
        ensuredReferencedShells: {
            functions: new Set(),
            menus: new Set(),
            regions: new Set(),
        },
        plannedReferencedShells: {
            functions: new Set(
                referencedShellPlan.functions.map((name) => name.toLowerCase())
            ),
            menus: new Set(referencedShellPlan.menus.map((name) => name.toLowerCase())),
            regions: new Set(
                referencedShellPlan.regions.map((name) => name.toLowerCase())
            ),
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
            units:
                tp?.wholeImportableTrusted === true && importable.type !== "ITEM"
                    ? 1
                    : estimateImportableUnits(
                          importable,
                          tp?.entry ?? null,
                          tp?.trustMode === true,
                          importable.type === "ITEM" &&
                              readInteractDataCache(
                                  importable,
                                  itemDependencies,
                                  selection.housingUuid
                              ) !== undefined
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

    const plans: Array<{ row: (typeof rowsMeta)[number]; plan: ImportablePlan }> = [];
    const noOpRows: Array<{ row: (typeof rowsMeta)[number]; plan: ImportablePlan }> = [];
    const observedPlans: Array<{ plan: ImportablePlan }> = [];
    const trustedRows: (typeof rowsMeta)[number][] = [];
    const plannedApplicationUnits = new Map<string, ImportablePlan["applicationUnits"]>();
    const reads: Array<{ row: (typeof rowsMeta)[number]; read: ImportableRead }> = [];
    const pendingHouseLockEntries: PendingHouseLockEntries = new Map();
    const verifiedDependencyContext: VerifiedDependencyContext = {
        dependencies: itemDependencies,
        projectItems: items,
        housingUuid: selection.housingUuid,
        tracker: itemVerification,
        observations: itemFieldObservations,
        itemContent: itemDiff.fieldContent,
        trustPlan,
        trustedItemOwners,
    };

    const hydrated: typeof reads = [];
    for (
        let chunkStart = 0;
        chunkStart < rowsMeta.length;
        chunkStart += SCAN_HYDRATE_CHUNK_SIZE
    ) {
        const chunkReads: typeof reads = [];
        const chunkEnd = Math.min(rowsMeta.length, chunkStart + SCAN_HYDRATE_CHUNK_SIZE);
        for (let i = chunkStart; i < chunkEnd; i++) {
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
            if (row.trustPlan?.wholeImportableTrusted && row.importable.type !== "ITEM") {
                emitKnowledgeSource(events, "cache", "whole-importable", row.trustPlan);
                trustedRows.push(row);
                plannedApplicationUnits.set(row.key, COST.cacheWrite);
                continue;
            }

            if (row.importable.type !== "ITEM") {
                emitKnowledgeSource(events, "house", "shell-read", row.trustPlan);
            }
            try {
                const entry = {
                    row,
                    read: await scanImportable(ctx, row.importable, session),
                };
                reads.push(entry);
                chunkReads.push(entry);
            } catch (error) {
                const outcome = await persistHydratedReads(
                    ctx,
                    hydrated,
                    session,
                    selection,
                    pendingHouseLockEntries,
                    verifiedDependencyContext
                );
                if (isTaskCancelled(error)) {
                    reportCancellationCache(ctx, error, outcome);
                    throw error;
                }
                const diag = toImportDiagnostic(error, "read", row.importable.type);
                events?.emit({
                    kind: "importableFinished",
                    key: row.key,
                    status: "failed",
                    error: diag.message,
                });
                const logPath = writeTaskFailureLog(
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
                    if (trace) {
                        traceNote(
                            "read-stack",
                            trace.split("\n").slice(0, 8).join(" | ")
                        );
                    }
                }
                ctx.displayMessage(
                    `&c[htsw] Import aborted while scanning ${row.importable.type} ${row.identity}; no changes applied.`
                );
                reportSavedObservedState(ctx, outcome.savedCount, outcome.lockUpdated);
                ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
                events?.emit({ kind: "sessionFinished" });
                return;
            }
        }

        for (const entry of chunkReads) {
            if (!entry.read.needsHydration) {
                hydrated.push(entry);
                continue;
            }
            events?.emit({
                kind: "importableReactivated",
                key: entry.row.key,
                rowIndex: entry.row.rowIndex,
                phase: "hydrating",
            });
            try {
                await entry.read.hydrate(ctx);
                hydrated.push(entry);
            } catch (error) {
                const outcome = await persistHydratedReads(
                    ctx,
                    hydrated,
                    session,
                    selection,
                    pendingHouseLockEntries,
                    verifiedDependencyContext
                );
                if (isTaskCancelled(error)) {
                    reportCancellationCache(ctx, error, outcome);
                    throw error;
                }
                const row = entry.row;
                const diag = toImportDiagnostic(error, "read", row.importable.type);
                events?.emit({
                    kind: "importableFinished",
                    key: row.key,
                    status: "failed",
                    error: diag.message,
                });
                const logPath = writeTaskFailureLog(
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
                reportSavedObservedState(ctx, outcome.savedCount, outcome.lockUpdated);
                ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
                events?.emit({ kind: "sessionFinished" });
                return;
            }
        }
    }

    for (const { row, read } of reads) {
        const plan = read.plan(session);
        plannedApplicationUnits.set(row.key, plan.applicationUnits);
        observedPlans.push({ plan });
        if (plan.isNoOp()) {
            noOpRows.push({ row, plan });
        } else {
            plans.push({ row, plan });
        }
    }

    if (session.actions.conflicts.length > 0) {
        const proceed =
            selection.conflictHandling.kind === "proceed"
                ? true
                : await selection.conflictHandling.decide(session.actions.conflicts);
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

    await writeObservedPlanCaches(
        ctx,
        observedPlans,
        selection.housingUuid,
        pendingHouseLockEntries,
        verifiedDependencyContext,
        true
    );
    await flushHouseLockEntries(
        selection.sourcePath,
        selection.housingUuid,
        pendingHouseLockEntries
    );

    let activePlanIndex: number | null = null;
    try {
        events?.emit({
            kind: "sessionTotalsLocked",
            plannedRows: rowsMeta.map((row) => {
                const applicationUnits = plannedApplicationUnits.get(row.key);
                if (applicationUnits === undefined) {
                    throw new Error(
                        `Missing application total for ${row.importable.type} ${row.identity}.`
                    );
                }
                return { key: row.key, applicationUnits };
            }),
            sessionApplicationUnits:
                referencedShellPlanApplicationUnits(referencedShellPlan),
        });
        let completedSessionApplicationUnits = 0;
        await applyReferencedShellPlan(
            ctx,
            referencedShellPlan,
            async (kind, name, created) => {
                if (created) {
                    ctx.displayMessage(
                        `&7[htsw] Created referenced ${kind} '&f${name}&7'.`
                    );
                }
                if (created && kind === "function") {
                    await recordEmptyFunctionShell(ctx, session, name);
                }
                completedSessionApplicationUnits += referencedShellApplicationUnits(kind);
                events?.emit({
                    kind: "sessionApplicationProgress",
                    completedUnits: completedSessionApplicationUnits,
                });
            }
        );
        const plannedSessionApplicationUnits =
            referencedShellPlanApplicationUnits(referencedShellPlan);
        if (
            Math.abs(completedSessionApplicationUnits - plannedSessionApplicationUnits) >
            1e-6
        ) {
            throw new Error(
                `Referenced shell application completed ${completedSessionApplicationUnits} of ${plannedSessionApplicationUnits} planned units.`
            );
        }
        for (const name of referencedShellPlan.functions) {
            session.ensuredReferencedShells.functions.add(name.toLowerCase());
        }
        for (const name of referencedShellPlan.menus) {
            session.ensuredReferencedShells.menus.add(name.toLowerCase());
        }
        for (const name of referencedShellPlan.regions) {
            session.ensuredReferencedShells.regions.add(name.toLowerCase());
        }

        for (const row of trustedRows) {
            events?.emit({
                kind: "importableReactivated",
                key: row.key,
                rowIndex: row.rowIndex,
                phase: "applying",
            });
            await finishWithoutApply(
                ctx,
                row,
                "skipped",
                defineApplicationPlan([workStep("cache", COST.cacheWrite)]),
                selection,
                itemDependencies,
                itemContentForLock(row.importable, items, itemDiff.fieldContent),
                events,
                pendingHouseLockEntries
            );
        }

        for (const { row, plan } of noOpRows) {
            events?.emit({
                kind: "importableReactivated",
                key: row.key,
                rowIndex: row.rowIndex,
                phase: "applying",
            });
            await finishWithoutApply(
                ctx,
                row,
                "imported",
                plan.applicationPlan,
                selection,
                itemDependencies,
                itemContentForLock(row.importable, items, itemDiff.fieldContent),
                events,
                pendingHouseLockEntries
            );
        }

        for (let planIndex = 0; planIndex < plans.length; planIndex++) {
            activePlanIndex = planIndex;
            const { row, plan } = plans[planIndex];
            events?.emit({
                kind: "importableReactivated",
                key: row.key,
                rowIndex: row.rowIndex,
                phase: "applying",
            });
            try {
                const application = new ApplicationProgress(plan.applicationPlan, events);
                await plan.apply(ctx, session, application);
                const cacheSaved = await application.run("cache", () =>
                    tryWriteImportableCache(
                        ctx,
                        row.importable,
                        "importer",
                        selection.housingUuid,
                        {
                            itemDependencies: itemDependencies.snapshotOf(row.importable),
                        }
                    )
                );
                application.assertComplete();
                if (cacheSaved) {
                    setPendingHouseLockEntry(pendingHouseLockEntries, {
                        importable: row.importable,
                        itemDependencies: itemDependencies.snapshotOf(row.importable),
                        itemContent: itemDiff.fieldContent,
                    });
                }
                events?.emit({
                    kind: "importableFinished",
                    key: row.key,
                    status: "imported",
                });
            } catch (error) {
                if (isTaskCancelled(error)) throw error;
                const partialSaved = await maybeWritePartialImportCache(
                    ctx,
                    plan,
                    selection.housingUuid,
                    actionListApplyResultFromError(error),
                    pendingHouseLockEntries,
                    verifiedDependencyContext
                );
                if (!partialSaved) {
                    removePendingHouseLockEntry(
                        pendingHouseLockEntries,
                        row.importable.type,
                        row.identity
                    );
                    deleteImportableCache(
                        selection.housingUuid,
                        row.importable.type,
                        row.identity
                    );
                }
                const diag = toImportDiagnostic(error, "import", row.importable.type);
                events?.emit({
                    kind: "importableFinished",
                    key: row.key,
                    status: "failed",
                    error: diag.message,
                });
                const logPath = writeTaskFailureLog(
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
                ctx.displayMessage(
                    partialSaved
                        ? "&7[htsw] Saved the last verified partial state to cache for retry."
                        : "&7[htsw] No verified partial state was available; the stale cache entry was removed."
                );
                ctx.displayMessage(`&7[htsw] Details in the failure log: &f${logPath}`);
                break;
            }
        }
        await session.itemPlacement.restore(ctx);
    } catch (error) {
        if (!isTaskCancelled(error)) throw error;

        let invalidatedCurrent = false;
        let invalidationFailed = false;
        if (activePlanIndex !== null) {
            const active = plans[activePlanIndex];
            const partialSaved = await maybeWritePartialImportCache(
                ctx,
                active.plan,
                selection.housingUuid,
                actionListApplyResultFromError(error),
                pendingHouseLockEntries,
                verifiedDependencyContext
            );
            if (!partialSaved) {
                removePendingHouseLockEntry(
                    pendingHouseLockEntries,
                    active.row.importable.type,
                    active.row.identity
                );
                const invalidated = deleteImportableCache(
                    selection.housingUuid,
                    active.row.importable.type,
                    active.row.identity
                );
                invalidatedCurrent = invalidated;
                invalidationFailed = !invalidated;
            }
        }

        const savedCount = pendingHouseLockEntries.size;
        const lockUpdated = await flushHouseLockEntries(
            selection.sourcePath,
            selection.housingUuid,
            pendingHouseLockEntries
        );
        await restoreItemPlacementAfterCancellation(ctx, session);
        reportCancellationCache(ctx, error, {
            savedCount,
            lockUpdated,
            invalidatedCurrent,
            invalidationFailed,
        });
        throw error;
    }

    if (
        !(await flushHouseLockEntries(
            selection.sourcePath,
            selection.housingUuid,
            pendingHouseLockEntries
        ))
    ) {
        ctx.displayMessage(
            "&e[htsw] Hydrated house state was cached, but house.lock could not be updated; retry may need to read it again."
        );
    }
    events?.emit({ kind: "sessionFinished" });
}

async function restoreItemPlacementAfterCancellation(
    ctx: TaskContext,
    session: ImportContext
): Promise<void> {
    try {
        await ctx.finishCancellationCleanup(() => session.itemPlacement.restore(ctx));
    } catch (error) {
        if (isTaskCancelled(error)) return;
        ctx.displayMessage(
            `&e[htsw] Could not finish inventory cleanup after cancellation: ${String(error)}`
        );
    }
}

async function finishWithoutApply(
    ctx: TaskContext,
    row: {
        importable: Importable;
        key: string;
    },
    status: "imported" | "skipped",
    applicationPlan: ApplicationPlan,
    selection: ImportSessionRequest,
    itemDependencies: ItemDependencyIndex,
    itemContent: ItemFieldContent,
    events: SyncEventHandler | undefined,
    pendingHouseLockEntries: PendingHouseLockEntries
): Promise<void> {
    const application = new ApplicationProgress(applicationPlan, events);
    const dependencies = itemDependencies.snapshotOf(row.importable);
    const cacheSaved = await application.run("cache", () =>
        tryWriteImportableCache(ctx, row.importable, "importer", selection.housingUuid, {
            itemDependencies: dependencies,
        })
    );
    application.assertComplete();
    if (cacheSaved) {
        setPendingHouseLockEntry(pendingHouseLockEntries, {
            importable: row.importable,
            itemDependencies: dependencies,
            itemContent,
        });
    }
    events?.emit({ kind: "importableFinished", key: row.key, status });
}

function verifiedSnapshotFor(
    importable: Importable,
    context: VerifiedDependencyContext
): ItemDependencySnapshot {
    const trust = context.trustPlan.importables.get(
        importableKey(importable.type, importableIdentity(importable))
    );
    return verifiedItemDependencies(
        importable,
        context.dependencies,
        context.projectItems,
        context.housingUuid,
        context.tracker,
        context.observations,
        context.trustedItemOwners,
        trust?.entry?.itemDependencies
    );
}

async function persistHydratedReads(
    ctx: TaskContext,
    hydrated: ReadonlyArray<{ read: ImportableRead }>,
    session: ImportContext,
    selection: ImportSessionRequest,
    pendingHouseLockEntries: PendingHouseLockEntries,
    verifiedContext: VerifiedDependencyContext
): Promise<CancellationCacheOutcome> {
    const plans = hydrated.map(({ read }) => ({ plan: read.plan(session) }));
    const savedCount = await writeObservedPlanCaches(
        ctx,
        plans,
        selection.housingUuid,
        pendingHouseLockEntries,
        verifiedContext
    );
    const lockUpdated = await flushHouseLockEntries(
        selection.sourcePath,
        selection.housingUuid,
        pendingHouseLockEntries
    );
    return {
        savedCount,
        lockUpdated,
        invalidatedCurrent: false,
        invalidationFailed: false,
    };
}

function reportSavedObservedState(
    ctx: TaskContext,
    savedCount: number,
    lockUpdated: boolean
): void {
    if (savedCount === 0) return;
    const noun = savedCount === 1 ? "importable" : "importables";
    const retry = lockUpdated ? " Retry can reuse them." : "";
    ctx.displayMessage(
        `&7[htsw] Saved verified house state for ${savedCount} ${noun}.${retry}`
    );
}

/** Cache the partially-applied state after a failed apply. */
async function maybeWritePartialImportCache(
    ctx: TaskContext,
    plan: ImportablePlan,
    housingUuid: string,
    result: ActionListApplyResult | null,
    pendingHouseLockEntries: PendingHouseLockEntries,
    verifiedContext: VerifiedDependencyContext
): Promise<boolean> {
    const partial = plan.reconstructPartial(result);
    if (partial === null) return false;
    const itemDependencies = verifiedSnapshotFor(plan.importable, verifiedContext);
    if (
        !(await tryWriteImportableCache(ctx, partial, "importer", housingUuid, {
            itemDependencies,
        }))
    ) {
        return false;
    }
    setPendingHouseLockEntry(pendingHouseLockEntries, {
        importable: partial,
        itemDependencies,
        itemContent: itemContentForLock(
            partial,
            verifiedContext.projectItems,
            result?.itemContent ?? verifiedContext.itemContent
        ),
    });
    return true;
}

async function writeObservedPlanCaches(
    ctx: TaskContext,
    plans: ReadonlyArray<{ plan: ImportablePlan }>,
    housingUuid: string,
    pendingHouseLockEntries: PendingHouseLockEntries,
    verifiedContext: VerifiedDependencyContext,
    quiet: boolean = false
): Promise<number> {
    let savedCount = 0;
    for (const { plan } of plans) {
        const observed = plan.reconstructObserved();
        if (observed === null) continue;
        const itemDependencies = verifiedSnapshotFor(plan.importable, verifiedContext);
        const options = quiet ? { itemDependencies, quiet: true } : { itemDependencies };
        if (
            !(await tryWriteImportableCache(
                ctx,
                observed,
                "importer",
                housingUuid,
                options
            ))
        ) {
            continue;
        }
        setPendingHouseLockEntry(pendingHouseLockEntries, {
            importable: observed,
            itemDependencies,
            itemContent: itemContentForLock(
                observed,
                verifiedContext.projectItems,
                verifiedContext.itemContent
            ),
        });
        savedCount++;
    }
    return savedCount;
}

function itemContentForLock(
    importable: Importable,
    projectItems: ProjectItemIndex,
    preferred: ItemFieldContent | undefined
): ItemFieldContent {
    const fallback = sourceItemFieldContent(importable, projectItems);
    if (preferred === undefined) return fallback;
    return (owner, property) => preferred(owner, property) ?? fallback(owner, property);
}

async function flushHouseLockEntries(
    sourcePath: string,
    housingUuid: string,
    entries: PendingHouseLockEntries
): Promise<boolean> {
    return await upsertHouseLockImportablesOffThread(
        sourcePath,
        housingUuid,
        Array.from(entries.values())
    );
}

function setPendingHouseLockEntry(
    entries: PendingHouseLockEntries,
    entry: HouseLockImportableUpdate
): void {
    entries.set(
        importableKey(entry.importable.type, importableIdentity(entry.importable)),
        entry
    );
}

function removePendingHouseLockEntry(
    entries: PendingHouseLockEntries,
    type: Importable["type"],
    identity: string
): void {
    entries.delete(importableKey(type, identity));
}

type CancellationCacheOutcome = {
    savedCount: number;
    lockUpdated: boolean;
    invalidatedCurrent: boolean;
    invalidationFailed: boolean;
};

type CancellationWithCacheReport = {
    __htswCancellationCacheReported?: boolean;
};

function reportCancellationCache(
    ctx: TaskContext,
    error: unknown,
    outcome: CancellationCacheOutcome
): void {
    const reportable =
        error !== null && (typeof error === "object" || typeof error === "function")
            ? (error as CancellationWithCacheReport)
            : null;
    if (reportable?.__htswCancellationCacheReported === true) return;
    if (reportable !== null) reportable.__htswCancellationCacheReported = true;

    if (outcome.savedCount > 0) {
        const noun = outcome.savedCount === 1 ? "importable" : "importables";
        const retry = outcome.lockUpdated ? "; retry can reuse the cache" : "";
        ctx.displayMessage(
            `&a[htsw] Cancellation saved verified house state for &f${outcome.savedCount}&a ${noun}${retry}.`
        );
        if (!outcome.lockUpdated) {
            ctx.displayMessage(
                "&e[htsw] The cache files were saved, but house.lock could not be updated; retry may need to read them again."
            );
        }
    } else if (!outcome.invalidatedCurrent && !outcome.invalidationFailed) {
        ctx.displayMessage(
            "&7[htsw] Cancellation had no new verified house state to save; existing cache was left unchanged."
        );
    } else {
        ctx.displayMessage(
            "&7[htsw] Cancellation could not save a verified state for the current importable."
        );
    }

    if (outcome.invalidatedCurrent) {
        ctx.displayMessage(
            "&e[htsw] The current importable stopped during an unverified change, so its stale cache entry was removed."
        );
    } else if (outcome.invalidationFailed) {
        ctx.displayMessage(
            "&c[htsw] The current importable stopped during an unverified change and its stale cache entry could not be removed. Retry with Trusted disabled."
        );
    }
}
