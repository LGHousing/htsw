import { Diagnostic, SourceMap, parseActionsResult } from "htsw";

import { appendActionsToOpenActionList } from "./housingSync/actions/apply";
import { runHousingSyncTask } from "./housingSync/taskRunner";
import { createProjectItemIndex } from "./importables/items/projectItems";
import { createItemFieldResolver } from "./importables/items/resolveItem";
import { TaskManager } from "./tasks/manager";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { FileSystemFileLoader } from "./utils/fileLoaders";
import { compactFileLabel } from "./gui/lib/pathDisplay";
import { emitBridgeEvent, rejectBridgeRun } from "./bridge/status";

export function appendRawHtslFile(path: string): void {
    if (TaskManager.isBusy()) {
        rejectBridgeRun("import", "busy", "htsw_raw_import");
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }

    const sm = new SourceMap(new FileSystemFileLoader());
    const result = parseActionsResult(sm, path);
    printDiagnostics(sm, result.diagnostics);

    const errCount = result.diagnostics.filter(
        (diagnostic) => diagnostic.level === "error" || diagnostic.level === "bug"
    ).length;
    if (errCount > 0) {
        rejectBridgeRun("import", "parse_errors", "htsw_raw_import");
        printDiagnostic(
            sm,
            Diagnostic.error(
                `Raw HTSL import failed with ${errCount} error${errCount === 1 ? "" : "s"}`
            )
        );
        return;
    }

    if (result.value.length === 0) {
        rejectBridgeRun("import", "no_actions", "htsw_raw_import");
        ChatLib.chat(`&c[htsw] No actions found in ${path}`);
        return;
    }

    const items = createProjectItemIndex([], result.gcx);
    const resolveItem = createItemFieldResolver(items);
    runHousingSyncTask(
        "import",
        async (ctx) => {
            if (ctx.tryGetMenuItemSlot("Add Action") === null) {
                throw new Error("Open a Housing action-list menu first.");
            }

            const count = result.value.length;
            ChatLib.chat(
                `&7[htsw] Appending ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
            );
            await appendActionsToOpenActionList(ctx, result.value, resolveItem);
            emitBridgeEvent("htsw_raw_import", {
                status: "completed",
                count,
                file: compactFileLabel(path),
                path,
            });
            ChatLib.chat(
                `&a[htsw] Appended ${count} action${count === 1 ? "" : "s"} from ${compactFileLabel(path)}`
            );
        },
        { diagnostic: "htsw_raw_import" }
    ).catch((err: unknown) => {
        if (err instanceof Diagnostic) {
            printDiagnostic(sm, err);
            return;
        }
        ChatLib.chat(`&c[htsw] Raw HTSL import failed: ${String(err)}`);
    });
}
