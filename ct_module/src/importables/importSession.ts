import { Diagnostic, SourceMap, parseImportablesResult, type ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/files";
import {
    buildTrustPlan,
    getCurrentHousingUuid,
    importableIdentity,
    trustPlanKey,
    writeImportableCache,
} from "../importCache";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
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
    const parsed = selection.parsed ?? parseImportablesResult(
        new SourceMap(new FileSystemFileLoader()),
        selection.sourcePath
    );
    const sm = new SourceMap(new FileSystemFileLoader());
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const ordered = orderImportablesForImportSession(parsed.value, selection.importables);
    await ctx.sleep(1);
    const trustPlan = buildTrustPlan(
        selection.housingUuid,
        parsed.value,
        selection.trustMode
    );

    const events = selection.events;
    const importableUnits: number[] = ordered.map((importable) => {
        const identity = importableIdentity(importable);
        const tp = trustPlan.importables.get(trustPlanKey(importable.type, identity));
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
        const tp = trustPlan.importables.get(trustPlanKey(importable.type, identity));
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
            plans.push({ row, plan });
        } catch (error) {
            if (isTaskCancelled(error)) {
                throw error;
            }
            events?.emit({ kind: "importableFinished", key: row.key, status: "failed" });
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to read ${row.importable.type}: ${error}`);
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
            events?.emit({ kind: "importableFinished", key: row.key, status: "failed" });
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${row.importable.type}: ${error}`);
            }
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
        ctx.displayMessage(
            `&7[knowledge] &eSkipped cache write for trusted ${importable.type}: ${error}`
        );
    }
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
