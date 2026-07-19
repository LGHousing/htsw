import type { ImportableCommand } from "htsw/types";
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
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    commandExportReferencesExist,
    htslTargetForCommandExport,
} from "../../project/paths";
import { makeReadHouse, type BatchState } from "../readHouse";
import {
    openCommandSettings,
    openExistingCommandActionsEditor,
    readOpenCommandSettings,
} from "./shared";
import { listAllCommandNames, resetCommandNameSession } from "./listCommands";

type PendingCommandRead = {
    scan: ActionListScan;
    settings: {
        mode: ImportableCommand["mode"];
        requiredPriority: ImportableCommand["requiredPriority"];
        listed: boolean;
    };
};

async function readCommand(
    ctx: TaskContext,
    name: string,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<ImportableCommand> {
    await openExistingCommandActionsEditor(ctx, name);
    const actions = await readActionListFully(ctx, {
        itemReadMode: "export",
        itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });

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

async function scanCommand(
    ctx: TaskContext,
    name: string,
    state: BatchState,
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

    await openCommandSettings(ctx, name);
    const settings = readOpenCommandSettings(ctx);
    if (settings.listed === null) {
        throw new Error(`Could not read listed state for command "/${name}".`);
    }

    return {
        scan,
        settings: {
            mode: settings.mode,
            requiredPriority: settings.requiredPriority,
            listed: settings.listed,
        },
    };
}

async function hydrateCommand(
    ctx: TaskContext,
    name: string,
    pending: PendingCommandRead,
    state: BatchState,
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

    return {
        type: "COMMAND",
        name,
        actions,
        mode: pending.settings.mode,
        requiredPriority: pending.settings.requiredPriority,
        listed: pending.settings.listed,
    };
}

async function writeCommandResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableCommand,
    options: {
        importJsonPath: string;
        newExportTargetImportJson?: string;
        readOnly?: { housingUuid: string };
    }
): Promise<void> {
    if (options.readOnly !== undefined) {
        writeImportableCache(
            ctx,
            options.readOnly.housingUuid,
            importable,
            "reader",
            true
        );
        return;
    }

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

    ctx.displayMessage(
        `&aExported command '/${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

async function exportCommand(
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
    await writeCommandResult(
        ctx,
        name,
        await readCommand(ctx, name, state.itemCaptures, onReadProgress),
        options
    );
}

export const readCommands = makeReadHouse<string>({
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
    readOne: (ctx, name, options, state, onReadProgress) =>
        exportCommand(ctx, name, options, state, onReadProgress),
    scanOne: (ctx, name, options, state, onReadProgress) =>
        scanCommand(ctx, name, state, onReadProgress, options.progress?.events),
    hydrateOne: async (ctx, name, pending, options, state, onReadProgress) => {
        const importable = await hydrateCommand(
            ctx,
            name,
            pending as PendingCommandRead,
            state,
            onReadProgress,
            options.progress?.events
        );
        await writeCommandResult(ctx, name, importable, options);
    },
});
