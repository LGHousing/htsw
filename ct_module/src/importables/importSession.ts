import { Diagnostic, SourceMap, parseImportablesResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/files";
import { buildTrustPlan, importableIdentity, trustPlanKey } from "../importCache";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
import { importImportable } from "./imports";
import type { ImportEventHandler } from "../importer/importEvents";
import type { ImportableEntry } from "../importer/progress/types";
import { importProgressKey } from "../importer/progress/keys";
import {
    estimateImportableCost,
    setupUnitsForImportable,
} from "../importer/progress/costs";
import { readImportableCache } from "../importCache/cache";
import { readCachedActionList } from "./actionListHelpers";

export type ImportSelection = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    events?: ImportEventHandler;
};

export function orderImportablesForImportSession(
    allImportables: readonly Importable[],
    selectedImportables: readonly Importable[]
): Importable[] {
    const selectedKeys = new Set(
        selectedImportables.map((importable) =>
            trustPlanKey(importable.type, importableIdentity(importable))
        )
    );
    return [
        ...allImportables.filter((i) => i.type === "ITEM"),
        ...allImportables.filter((i) => i.type !== "ITEM"),
    ].filter((importable) =>
        selectedKeys.has(trustPlanKey(importable.type, importableIdentity(importable)))
    );
}

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<void> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sm, selection.sourcePath);
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const ordered = orderImportablesForImportSession(parsed.value, selection.importables);
    const trustPlan = buildTrustPlan(
        selection.housingUuid,
        parsed.value,
        selection.trustMode
    );

    const events = selection.events;
    const importableUnits: number[] = ordered.map((importable) =>
        estimateImportableUnitsWithCache(importable, selection.housingUuid)
    );
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

    for (let i = 0; i < ordered.length; i++) {
        const importable = ordered[i];
        const identity = importableIdentity(importable);
        const trustKey = trustPlanKey(importable.type, identity);
        const plan = trustPlan?.importables.get(trustKey);
        const key = importProgressKey(importable.type, identity, selection.sourcePath);
        const cacheEntry = readImportableCache(
            selection.housingUuid,
            importable.type,
            identity
        );
        events?.emit({
            kind: "importableStarted",
            key,
            type: importable.type,
            identity,
            setupUnits: setupUnitsForImportable(importable),
            initialUnits: importableUnits[i],
            rowIndex: i,
            cached: cacheEntry === null ? null : cacheEntry.importable,
        });

        if (plan?.wholeImportableTrusted) {
            events?.emit({ kind: "importableFinished", key, status: "skipped" });
            continue;
        }

        try {
            await importImportable(ctx, importable, registry, {
                plan,
                housingUuid: selection.housingUuid,
                events,
            });
            events?.emit({ kind: "importableFinished", key, status: "imported" });
        } catch (error) {
            if (isTaskCancelled(error)) {
                throw error;
            }
            events?.emit({ kind: "importableFinished", key, status: "failed" });
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${importable.type}: ${error}`);
            }
            // Halt the session on first failure rather than ploughing
            // through the remaining importables — they're often dependent
            // on each other and a partial import is worse than a clean
            // abort. The user can fix the failing importable and retry.
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${importable.type} ${identity}`
            );
            break;
        }
    }

    events?.emit({ kind: "sessionFinished" });
}

function estimateImportableUnitsWithCache(
    importable: Importable,
    housingUuid: string
): number {
    const entry = readImportableCache(
        housingUuid,
        importable.type,
        importableIdentity(importable)
    );
    if (entry === null) {
        return Math.max(1, estimateImportableCost(importable));
    }
    const getCached = (basePath: string) =>
        readCachedActionList(entry.importable, basePath);
    return Math.max(1, estimateImportableCost(importable, getCached));
}
