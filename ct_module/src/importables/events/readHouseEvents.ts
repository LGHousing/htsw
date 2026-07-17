import type { Event, ImportableEvent } from "htsw/types";
import * as htsw from "htsw";

import { type ActionListScan, scanActionList } from "../../housingSync/actions/readList";
import {
    completeActionListScan,
    readActionListFully,
} from "../../housingSync/actions/hydration/run";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    eventExportReferencesExist,
    htslTargetForEventExport,
} from "../../project/paths";
import { makeReadHouse, type BatchState } from "../readHouse";
import { openEventEditor } from "./shared";
import { listAllEventNames } from "./listEvents";

type PendingEventRead = {
    scan: ActionListScan;
};

async function scanEvent(
    ctx: TaskContext,
    name: string,
    state: BatchState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<PendingEventRead> {
    await openEventEditor(ctx, name);
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
    return { scan };
}

async function hydrateEvent(
    ctx: TaskContext,
    name: string,
    pending: PendingEventRead,
    state: BatchState,
    onReadProgress: ProgressHandler | undefined,
    events: SyncEventHandler | undefined
): Promise<ImportableEvent> {
    await openEventEditor(ctx, name);
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
        type: "EVENT",
        event: name as Event,
        actions,
    };
}

async function writeEventResult(
    ctx: TaskContext,
    name: string,
    importable: ImportableEvent,
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

    const target = htslTargetForEventExport(
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

    upsertImportableEntry(target.importJsonPath, "events", {
        event: name,
        actions: target.htslReference,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

async function exportEvent(
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
    await openEventEditor(ctx, name);
    const actions = await readActionListFully(ctx, {
        itemCaptures: state.itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });

    const importable: ImportableEvent = {
        type: "EVENT",
        event: name as Event,
        actions,
    };

    await writeEventResult(ctx, name, importable, options);
}

export const readEvents = makeReadHouse<string>({
    type: "EVENT",
    noun: "event",
    list: listAllEventNames,
    capturesActionItems: true,
    referencesExist: eventExportReferencesExist,
    exportSummary: (state) => {
        const count = state.itemCaptures.size();
        return ` (${count} item${count === 1 ? "" : "s"} captured)`;
    },
    readOne: (ctx, name, options, state, onReadProgress) =>
        exportEvent(ctx, name, options, state, onReadProgress),
    scanOne: (ctx, name, options, state, onReadProgress) =>
        scanEvent(ctx, name, state, onReadProgress, options.progress?.events),
    hydrateOne: async (ctx, name, pending, options, state, onReadProgress) => {
        const importable = await hydrateEvent(
            ctx,
            name,
            pending as PendingEventRead,
            state,
            onReadProgress,
            options.progress?.events
        );
        await writeEventResult(ctx, name, importable, options);
    },
});
