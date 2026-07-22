import type { ImportableFunction } from "htsw/types";
import * as htsw from "htsw";

import { type ActionListScan, scanActionList } from "../../housingSync/actions/readList";
import { completeActionListScan } from "../../housingSync/actions/hydration/run";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { tryWriteImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    functionExportReferencesExist,
    htslTargetForFunctionExport,
} from "../../project/paths";
import {
    defineHouseExporter,
    type ExportReadState,
} from "../export/exporter";
import {
    openFunctionEditor,
    readFunctionSettings,
} from "./housing";
import {
    listAllFunctionNames,
    resetFunctionNameSession,
} from "./listFunctions";
import { functionSettingsForExport } from "./settings";

type PendingFunctionRead = {
    scan: ActionListScan;
};

async function scanFunction(
    ctx: TaskContext,
    name: string,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<PendingFunctionRead> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const scan = await scanActionList(
        ctx,
        { kind: "full" },
        {
            itemReadMode: "export",
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
    return { scan };
}

async function hydrateFunction(
    ctx: TaskContext,
    name: string,
    pending: PendingFunctionRead,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<ImportableFunction> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const actions = await completeActionListScan(ctx, pending.scan, {
        itemReadMode: "export",
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

    const settings = functionSettingsForExport(await readFunctionSettings(ctx, name));

    return {
        type: "FUNCTION",
        name,
        actions,
        ...settings,
    };
}

async function writeFunctionResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableFunction,
    options: {
        importJsonPath: string;
        newExportTargetImportJson?: string;
    }
): Promise<void> {
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

    const {
        type: _type,
        actions: _actions,
        sourcePath: _sourcePath,
        ...declaration
    } = importable;
    upsertImportableEntry(target.importJsonPath, "functions", {
        ...declaration,
        actions: target.htslReference,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

export const readFunctions = defineHouseExporter({
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
    reader: {
        kind: "staged",
        scan: (ctx, name, options, state, onReadProgress) =>
            scanFunction(ctx, name, state, onReadProgress, options.progress?.events),
        hydrate: (ctx, name, pending, options, state, onReadProgress) =>
            hydrateFunction(
                ctx,
                name,
                pending,
                state,
                onReadProgress,
                options.progress?.events
            ),
    },
    importableOf: (importable) => importable,
    export: (ctx, name, importable, options) =>
        writeFunctionResult(ctx, name, importable, options),
});
