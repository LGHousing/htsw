import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { ItemCaptureRegistry } from "../../housingSync/itemCapture";
import type { ExportProgressSink } from "../../exporter/exportProgress";
import { withExportSession } from "../exportSession";
import { exportMenu } from "./export";
import { listAllMenuNames } from "./listMenus";

export type ExportAllMenusOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
};

export async function exportAllMenus(
    ctx: TaskContext,
    options: ExportAllMenusOptions
): Promise<void> {
    return withExportSession(() => exportAllMenusInner(ctx, options));
}

async function exportAllMenusInner(
    ctx: TaskContext,
    options: ExportAllMenusOptions
): Promise<void> {
    const { importJsonPath, rootDir } = options;

    // One registry + written-set across every menu so identical slot items
    // collapse to a single shared items/<name>.snbt, written exactly once.
    const itemCaptures = new ItemCaptureRegistry();
    const writtenItems = new Set<string>();

    const names =
        options.names !== undefined ? options.names : await listAllMenuNames(ctx);
    if (names.length === 0) {
        ctx.displayMessage("&7No menus to export.");
        return;
    }

    ctx.displayMessage(
        `&aExporting ${names.length} menu${names.length === 1 ? "" : "s"}...`
    );
    options.progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            options.progress?.item(i, name);
            ctx.displayMessage(`&7[${i + 1}/${names.length}] &fExporting '${name}'`);

            try {
                await exportMenu(
                    ctx,
                    { name, importJsonPath, rootDir },
                    { itemCaptures, writtenItems }
                );
                succeeded++;
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                ctx.displayMessage(`&c[export-all] failed on '${name}': ${error}`);
            }
        }
    } finally {
        options.progress?.done();
    }

    ctx.displayMessage(
        `&aExported ${succeeded} of ${names.length} menu${names.length === 1 ? "" : "s"} (${itemCaptures.size()} unique item${itemCaptures.size() === 1 ? "" : "s"})${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}
