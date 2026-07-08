import type { Event, ImportableEvent } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    eventExportReferencesExist,
    htslTargetForEventExport,
} from "../../project/paths";
import { makeReadHouse, type BatchState } from "../readHouse";
import { openEventEditor } from "./shared";
import { listAllEventNames } from "./listEvents";

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
    const observed = await readActionList(ctx, { kind: "deep" }, {
        itemCaptures: state.itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    const actions = observedSlotsToActions(observed);

    const importable: ImportableEvent = {
        type: "EVENT",
        event: name as Event,
        actions,
    };

    if (options.readOnly !== undefined) {
        writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
        return;
    }

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

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
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
});
