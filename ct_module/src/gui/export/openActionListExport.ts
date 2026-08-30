/// <reference types="../../../CTAutocomplete" />

import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { TaskManager } from "../../tasks/manager";
import { atomicWriteText } from "../../utils/filesystem";
import { StringFileLoader } from "../../utils/fileLoaders";
import { compactFileLabel } from "../lib/pathDisplay";
import { openFileBrowserWithHtslDestination } from "../popovers/file-browser";
import { showToast } from "../toast";

function standaloneHtsl(actions: readonly htsw.types.Action[]): string {
    const printed = htsw.htsl.printActionsWithDiagnostics(actions);
    if (printed.diagnostics.length > 0) {
        throw new Error(
            printed.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
        );
    }

    const parsed = htsw.parseActionsResult(
        new htsw.SourceMap(new StringFileLoader(printed.source)),
        "open-action-list.htsl"
    );
    const errors = parsed.diagnostics.filter(
        (diagnostic) => diagnostic.level === "error" || diagnostic.level === "bug"
    );
    if (errors.length > 0) {
        throw new Error(
            `Printed HTSL did not parse cleanly: ${errors.map((error) => error.message).join("; ")}`
        );
    }
    return printed.source;
}

export async function exportOpenActionListTo(path: string): Promise<void> {
    if (!path.toLowerCase().endsWith(".htsl")) {
        ChatLib.chat("&c[htsw] Open action-list exports require a .htsl destination.");
        return;
    }
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }

    try {
        await runHousingSyncTask("export", async (ctx) => {
            if (ctx.tryGetMenuItemSlot("Add Action") === null) {
                throw new Error("Open a supported Housing action-list menu first.");
            }

            const actions = await readActionListFully(ctx, {
                itemReadMode: "sync",
                canonicalizeItemName: (name) => name,
            });
            const source = standaloneHtsl(actions);
            if (!atomicWriteText(path, source)) {
                throw new Error(`Could not write ${path}`);
            }

            const count = actions.length;
            ChatLib.chat(
                `&a[htsw] Exported ${count} action${count === 1 ? "" : "s"} → ${path}`
            );
            showToast(
                `Exported ${compactFileLabel(path)} (${count} actions)`,
                0xff5cb85c
            );
        });
    } catch (err) {
        ChatLib.chat(`&c[htsw] Open action-list export failed: ${String(err)}`);
        showToast(`Export failed: ${String(err)}`, 0xffe85c5c, 8000);
    }
}

export function startOpenActionListExport(): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }
    openFileBrowserWithHtslDestination(undefined, (path) => {
        void exportOpenActionListTo(path);
    });
}
