import type { Action, Event, ImportableEvent } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import {
    ItemCaptureRegistry,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import { openEventEditor } from "./shared";

export type ExportEventOptions = {
    name: string;
    /** The project's ENTRY import.json — captured items resolve against it. */
    importJsonPath: string;
    /**
     * The import.json the event's entry is upserted into — its declaring
     * file when the identity already exists in the include tree (see
     * `htslTargetForEventExport`). Defaults to `importJsonPath`;
     * `htslPath`/`htslReference` must be computed against the same file.
     */
    declaringJsonPath?: string;
    htslPath: string;
    htslReference: string;
    rootDir: string;
    onReadProgress?: ProgressHandler;
};

export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

async function readEvent(
    ctx: TaskContext,
    eventName: string,
    itemCaptures?: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<Action[]> {
    await openEventEditor(ctx, eventName);
    const observed = await readActionList(ctx, { kind: "full" }, {
        ...(itemCaptures !== undefined ? { itemCaptures } : {}),
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    return observedSlotsToActions(observed);
}

export async function exportEventWithSharedState(
    ctx: TaskContext,
    options: ExportEventOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;

    const actions = await readEvent(ctx, name, shared.itemCaptures, options.onReadProgress);

    const importable: ImportableEvent = {
        type: "EVENT",
        event: name as Event,
        actions,
    };

    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(htslPath);
    FileLib.write(htslPath, source, true);

    upsertImportableEntry(options.declaringJsonPath ?? importJsonPath, "events", {
        event: name,
        actions: htslReference,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${htslPath}`);
}
