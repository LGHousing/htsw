import { Diagnostic, SourceMap, parseImportablesResult, type ImportablesParseResult } from "htsw";
import type { Importable, ImportableItem } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { isImportTraceEnabled, traceNote } from "../housingSync/trace/importTrace";
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
import { resetMenuNameSession } from "./menus/listMenus";
import { resetCommandNameSession } from "./commands/listCommands";
import { createNpcLookupCache } from "./npcs/listNpcs";
import {
    applyImportablePlan,
    planIsNoOp,
    prereadImportable,
    reconstructPartialImportable,
    type ImportablePlan,
    type ImportSession,
} from "./imports";
import {
    expandClickActionItemDependencies,
    referencedItemNames,
} from "./itemDependencies";
import type { ImportEventHandler } from "../housingSync/importEvents";
import type { ImportableEntry } from "../housingSync/progress/types";
import { importProgressKey } from "../housingSync/progress/keys";
import {
    estimateImportableUnits,
    setupUnitsForImportable,
} from "../housingSync/progress/costs";
import { writeImportFailureLog } from "../diagnostics/importFailureLog";
import { resetImportDiagnostics } from "../diagnostics/importDiagnosticsBuffer";

export type ImportSelection = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    parsed?: ImportablesParseResult;
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
    const selectedItems: ImportableItem[] = [];
    const rest: Importable[] = [];
    for (const imp of selectedImportables) {
        if (imp.type === "ITEM") selectedItems.push(imp);
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
    return orderedItems.concat(rest);
}

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<void> {
    resetImportDiagnostics();
    resetFunctionNameSession();
    resetMenuNameSession();
    resetCommandNameSession();

    const parsed = selection.parsed ?? parseImportablesResult(
        new SourceMap(new FileSystemFileLoader()),
        selection.sourcePath
    );
    const sm = new SourceMap(new FileSystemFileLoader());
    const items = createItemRegistry(parsed.value, parsed.gcx);

    const expansion = expandClickActionItemDependencies(
        items,
        selection.importables,
        selection.housingUuid
    );
    for (const item of expansion.addedItems) {
        ctx.displayMessage(
            `&7[htsw] Also importing item '&f${item.name}&7' — it has click actions and isn't in this house yet.`
        );
    }

    const orderedImportables = orderImportablesForImportSession(parsed.value, expansion.importables);
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
    const session: ImportSession = {
        parsed,
        items,
        housingUuid: selection.housingUuid,
        trust: trustPlan,
        events,
        npcLookup: createNpcLookupCache(),
    };
    const rowsMeta = orderedImportables.map((importable, rowIndex) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(importableKey(importable.type, identity));
        return {
            importable,
            identity,
            key: importProgressKey(importable.type, identity, selection.sourcePath),
            rowIndex,
            trustPlan: tp,
            units: estimateImportableUnits(importable, tp?.entry ?? null, tp?.trustMode === true),
        };
    });

    const rows: ImportableEntry[] = rowsMeta.map((row) => ({
        key: row.key,
        status: "queued",
        totalUnits: row.units,
    }));
    let initialTotalUnits = 0;
    for (const row of rowsMeta) initialTotalUnits += row.units;
    if (initialTotalUnits === 0) initialTotalUnits = 1;
    events?.emit({ kind: "sessionStarted", rows, initialTotalUnits });

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
            initialUnits: row.units,
            rowIndex: row.rowIndex,
            cached: cacheEntry === null ? null : cacheEntry.importable,
        });

        // A trusted ITEM still has work to do: the item itself must land in
        // the player's inventory (its apply spawns from the SNBT cache).
        if (row.trustPlan?.wholeImportableTrusted && row.importable.type !== "ITEM") {
            await tryWriteImportableCache(ctx, row.importable, "importer", selection.housingUuid);
            events?.emit({ kind: "importableFinished", key: row.key, status: "skipped" });
            continue;
        }

        try {
            const plan = await prereadImportable(ctx, row.importable, session);
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
            const logPath = writeImportFailureLog({
                phase: "pre-read",
                sourcePath: selection.sourcePath,
                housingUuid: selection.housingUuid,
                importableType: row.importable.type,
                identity: row.identity,
                rowIndex: row.rowIndex,
            }, error);
            if (isImportTraceEnabled()) {
                const stack = error as { stack?: string; rhinoException?: { getScriptStackTrace?: () => string } };
                const trace = stack.rhinoException?.getScriptStackTrace?.() ?? stack.stack;
                if (trace) traceNote("read-stack", String(trace).split("\n").slice(0, 8).join(" | "));
            }
            ctx.displayMessage(
                `&c[htsw] Import aborted during pre-read of ${row.importable.type} ${row.identity}; no changes applied.`
            );
            ctx.displayMessage(`&7[htsw] Wrote failure log: &f${logPath}`);
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
            await applyImportablePlan(ctx, plan, session);
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
            const logPath = writeImportFailureLog({
                phase: "apply",
                sourcePath: selection.sourcePath,
                housingUuid: selection.housingUuid,
                importableType: row.importable.type,
                identity: row.identity,
                rowIndex: row.rowIndex,
            }, error);
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${row.importable.type} ${row.identity}`
            );
            ctx.displayMessage(`&7[htsw] Wrote failure log: &f${logPath}`);
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
