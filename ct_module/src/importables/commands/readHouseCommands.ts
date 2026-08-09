import type { ImportableCommand } from "htsw/types";
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
    commandExportReferencesExist,
    htslTargetForCommandExport,
} from "../../project/paths";
import {
    defineHouseExporter,
    type ExportReadState,
} from "../export/exporter";
import type { ReadOptions } from "../export/reader";
import {
    openCommandSettings,
    openExistingCommandActionsEditor,
    readOpenCommandSettings,
} from "./housing";
import { listAllCommandNames, resetCommandNameSession } from "./listCommands";

type PendingCommandRead = {
    scan: ActionListScan;
};

async function scanCommand(
    ctx: TaskContext,
    name: string,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<PendingCommandRead> {
    await openExistingCommandActionsEditor(ctx, name);
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

async function hydrateCommand(
    ctx: TaskContext,
    name: string,
    pending: PendingCommandRead,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<ImportableCommand> {
    await openExistingCommandActionsEditor(ctx, name);
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

    await openCommandSettings(ctx, name);
    const settings = readOpenCommandSettings(ctx);
    if (settings.listed === null) {
        throw new Error(`Could not read listed state for command "/${name}".`);
    }
    await clickGoBack(ctx);

    return {
        type: "COMMAND",
        name,
        actions,
        mode: settings.mode,
        requiredPriority: settings.requiredPriority,
        listed: settings.listed,
    };
}

async function writeCommandResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableCommand,
    options: ReadOptions
): Promise<void> {
    const target = htslTargetForCommandExport(
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

    upsertImportableEntry(target.importJsonPath, "commands", {
        name,
        actions: target.htslReference,
        mode: importable.mode,
        requiredPriority: importable.requiredPriority,
        listed: importable.listed,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    if (options.progress === undefined && options.quiet !== true) {
        ctx.displayMessage(
            `&aExported command '/${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
        );
        ctx.displayMessage(`&7  -> ${target.htslPath}`);
    }
}

export const readCommands = defineHouseExporter({
    type: "COMMAND",
    noun: "command",
    prelude: resetCommandNameSession,
    list: listAllCommandNames,
    displayName: (name) => `/${name}`,
    capturesActionItems: true,
    referencesExist: commandExportReferencesExist,
    exportSummary: (state) => {
        const counts = state.itemCaptures.counts();
        return ` (items: ${counts.matched} matched, ${counts.fresh} new)`;
    },
    reader: {
        kind: "staged",
        scan: (ctx, name, options, state, onReadProgress) =>
            scanCommand(ctx, name, state, onReadProgress, options.progress?.events),
        hydrate: (ctx, name, pending, options, state, onReadProgress) =>
            hydrateCommand(
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
        writeCommandResult(ctx, name, importable, options),
});
