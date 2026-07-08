import type { ImportableCommand } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { ItemCaptureRegistry } from "../../housingSync/itemCapture";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../housingSync/observedActions";
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

async function readCommand(
    ctx: TaskContext,
    name: string,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<ImportableCommand> {
    await openExistingCommandActionsEditor(ctx, name);
    const observed = await readActionList(ctx, { kind: "deep" }, {
        itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    const actions = observedSlotsToActions(observed);

    await openCommandSettings(ctx, name);
    const settings = readOpenCommandSettings(ctx);
    if (settings.listed === null) {
        throw new Error(`Could not read listed state for command "/${name}".`);
    }

    return {
        type: "COMMAND",
        name,
        actions,
        mode: settings.mode,
        requiredPriority: settings.requiredPriority,
        listed: settings.listed,
    };
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
    const importable = await readCommand(ctx, name, state.itemCaptures, onReadProgress);

    if (options.readOnly !== undefined) {
        writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
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
});
