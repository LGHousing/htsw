import type { Action, ImportableFunction } from "htsw/types";
import * as htsw from "htsw";

import { type ActionListScan, scanActionList } from "../../housingSync/actions/readList";
import {
    completeActionListScan,
    readActionListFully,
} from "../../housingSync/actions/hydration/run";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { ItemCaptureRegistry } from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import { writeImportableCache } from "../../importCache/cache";
import TaskContext from "../../tasks/context";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    functionExportReferencesExist,
    htslTargetForFunctionExport,
} from "../../project/paths";
import { makeReadHouse, type BatchState } from "../readHouse";
import {
    openFunctionEditor,
    openFunctionSettings,
    readAutomaticExecutionTicks,
} from "./shared";
import { functionIconFromSnapshot } from "./icon";
import {
    getSessionFunctionIcon,
    listAllFunctionNames,
    resetFunctionNameSession,
} from "./listFunctions";

type PendingFunctionRead = {
    scan: ActionListScan;
    icon: ImportableFunction["icon"];
    repeatTicks?: number;
};

const validRepeatTicks = (repeatTicks: number | undefined): number | undefined =>
    repeatTicks !== undefined && repeatTicks >= 4 && repeatTicks <= 18000
        ? repeatTicks
        : undefined;

async function readFunction(
    ctx: TaskContext,
    name: string,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<{ actions: Action[]; repeatTicks?: number }> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const actions = await readActionListFully(ctx, {
        itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });

    await clickGoBack(ctx);
    await openFunctionSettings(ctx, name);

    const repeatTicks = readAutomaticExecutionTicks(ctx);
    await clickGoBack(ctx);
    const valid = validRepeatTicks(repeatTicks);
    return valid !== undefined ? { actions, repeatTicks: valid } : { actions };
}

// Read a function from the live house into a full `ImportableFunction` AST
// (actions + repeat + icon), writing nothing. Shared by the export and the
// Houses-tab deep read (which caches the result instead of writing import.json).
async function readFunctionImportable(
    ctx: TaskContext,
    name: string,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<ImportableFunction> {
    // The icon lives on the /functions list slot, not the editor — read it first.
    const icon = functionIconFromSnapshot(await getSessionFunctionIcon(ctx, name));
    const { actions, repeatTicks } = await readFunction(
        ctx,
        name,
        itemCaptures,
        onReadProgress
    );
    return {
        type: "FUNCTION",
        name,
        actions,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        ...(icon !== undefined ? { icon } : {}),
    };
}

async function scanFunction(
    ctx: TaskContext,
    name: string,
    state: BatchState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<PendingFunctionRead> {
    const icon = functionIconFromSnapshot(await getSessionFunctionIcon(ctx, name));
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const scan = await scanActionList(
        ctx,
        { kind: "full" },
        {
            itemCaptures: state.itemCaptures,
            exactHydrationEstimate: true,
            events,
            ...(onReadProgress !== undefined
                ? {
                      progress: onReadProgress,
                      phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
                  }
                : {}),
        }
    );

    await clickGoBack(ctx);
    await openFunctionSettings(ctx, name);
    const repeatTicks = validRepeatTicks(readAutomaticExecutionTicks(ctx));
    await clickGoBack(ctx);

    return {
        scan,
        icon,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
    };
}

async function hydrateFunction(
    ctx: TaskContext,
    name: string,
    pending: PendingFunctionRead,
    state: BatchState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<ImportableFunction> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const actions = await completeActionListScan(ctx, pending.scan, {
        itemCaptures: state.itemCaptures,
        exactHydrationEstimate: true,
        events,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    await clickGoBack(ctx);

    return {
        type: "FUNCTION",
        name,
        actions,
        ...(pending.repeatTicks !== undefined
            ? { repeatTicks: pending.repeatTicks }
            : {}),
        ...(pending.icon !== undefined ? { icon: pending.icon } : {}),
    };
}

async function writeFunctionResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableFunction,
    options: {
        importJsonPath: string;
        newExportTargetImportJson?: string;
        readOnly?: { housingUuid: string };
    }
): Promise<void> {
    if (options.readOnly !== undefined) {
        // Knowledge records what's REALLY in the function — items included.
        // Captures matched against the seeded project reuse real item names;
        // unmatched ones carry minted names whose only job is to make the
        // drift diff truthfully report "differs from your project".
        writeImportableCache(
            ctx,
            options.readOnly.housingUuid,
            importable,
            "reader",
            true
        );
        return;
    }

    const target = htslTargetForFunctionExport(
        options.importJsonPath,
        name,
        options.newExportTargetImportJson
    );
    const actions = importable.actions ?? [];
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(target.htslPath);
    FileLib.write(target.htslPath, source, true);

    upsertImportableEntry(target.importJsonPath, "functions", {
        name,
        actions: target.htslReference,
        ...(importable.repeatTicks !== undefined
            ? { repeatTicks: importable.repeatTicks }
            : {}),
        ...(importable.icon !== undefined ? { icon: importable.icon } : {}),
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

async function exportFunction(
    ctx: TaskContext,
    name: string,
    options: {
        importJsonPath: string;
        newExportTargetImportJson?: string;
        readOnly?: { housingUuid: string };
    },
    state: BatchState,
    onReadProgress: ProgressHandler | undefined
): Promise<void> {
    await writeFunctionResult(
        ctx,
        name,
        await readFunctionImportable(ctx, name, state.itemCaptures, onReadProgress),
        options
    );
}

export const readFunctions = makeReadHouse<string>({
    type: "FUNCTION",
    noun: "function",
    // Drop any function-list cache from a prior run so per-function icon reads
    // reflect the live house, not a stale snapshot.
    prelude: resetFunctionNameSession,
    list: listAllFunctionNames,
    capturesActionItems: true,
    referencesExist: functionExportReferencesExist,
    afterLoop: (ctx, state) => {
        const hints = state.itemCaptures.takeHints();
        for (let i = 0; i < hints.length; i++) {
            ctx.displayMessage(`&e[export] ${hints[i]}`);
        }
    },
    exportSummary: (state) => {
        const counts = state.itemCaptures.counts();
        return ` (items: ${counts.matched} matched, ${counts.fresh} new)`;
    },
    readOne: (ctx, name, options, state, onReadProgress) =>
        exportFunction(ctx, name, options, state, onReadProgress),
    scanOne: (ctx, name, options, state, onReadProgress) =>
        scanFunction(ctx, name, state, onReadProgress, options.progress?.events),
    hydrateOne: async (ctx, name, pending, options, state, onReadProgress) => {
        const importable = await hydrateFunction(
            ctx,
            name,
            pending as PendingFunctionRead,
            state,
            onReadProgress,
            options.progress?.events
        );
        await writeFunctionResult(ctx, name, importable, options);
    },
});
