import type { Action, Event, ImportableEvent } from "htsw/types";
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
    eventExportReferencesExist,
    htslTargetForEventExport,
} from "../../project/paths";
import {
    defineHouseExporter,
    type ExportReadState,
} from "../export/exporter";
import type { ReadOptions } from "../export/reader";
import { openEventEditor } from "./housing";
import { listAllEventNames } from "./listEvents";

type PendingEventRead = {
    scan: ActionListScan;
};

export function shouldIncludeEventInExport(actions: readonly Action[]): boolean {
    return actions.length > 0;
}

async function scanEvent(
    ctx: TaskContext,
    name: string,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<PendingEventRead> {
    await openEventEditor(ctx, name);
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

async function hydrateEvent(
    ctx: TaskContext,
    name: string,
    pending: PendingEventRead,
    state: ExportReadState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<ImportableEvent> {
    await openEventEditor(ctx, name);
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
        type: "EVENT",
        event: name as Event,
        actions,
    };
}

async function writeEventResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableEvent,
    options: ReadOptions
): Promise<void> {
    const actions = importable.actions;
    await tryWriteImportableCache(ctx, importable, "exporter");
    if (!shouldIncludeEventInExport(actions)) return;

    const target = htslTargetForEventExport(
        options.importJsonPath,
        name,
        options.newExportTargetImportJson
    );
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(target.htslPath);
    FileLib.write(target.htslPath, source, true);

    upsertImportableEntry(target.importJsonPath, "events", {
        event: name,
        actions: target.htslReference,
    });

    if (options.progress === undefined && options.quiet !== true) {
        ctx.displayMessage(
            `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
        );
        ctx.displayMessage(`&7  -> ${target.htslPath}`);
    }
}

export const readEvents = defineHouseExporter({
    type: "EVENT",
    noun: "event",
    list: listAllEventNames,
    capturesActionItems: true,
    referencesExist: eventExportReferencesExist,
    exportSummary: (state) => {
        const count = state.itemCaptures.size();
        return ` (${count} item${count === 1 ? "" : "s"} captured)`;
    },
    reader: {
        kind: "staged",
        scan: (ctx, name, options, state, onReadProgress) =>
            scanEvent(ctx, name, state, onReadProgress, options.progress?.events),
        hydrate: (ctx, name, pending, options, state, onReadProgress) =>
            hydrateEvent(
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
        writeEventResult(ctx, name, importable, options),
});
