import TaskContext from "../../tasks/context";
import { ItemCaptureRegistry } from "../../housingSync/itemCapture";
import { runReadLoop, type ReadResult, type ReadOptions } from "../read";
import { exportMenu } from "./export";
import { listAllMenuNames } from "./listMenus";
import { menuExportReferencesExist } from "../../project/paths";
import { filterAlreadyExported } from "../exportSkip";

export async function readMenus(
    ctx: TaskContext,
    options: ReadOptions
): Promise<ReadResult> {
    const { importJsonPath, rootDir } = options;
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";

    // One registry + written-set across every menu so identical slot items
    // collapse to a single shared items/<name>.snbt, written exactly once.
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }
    const writtenItems = new Set<string>();

    let names0: readonly string[];
    if (options.names !== undefined) {
        names0 = options.names;
    } else {
        names0 = await listAllMenuNames(ctx);
        options.onNamesListed?.(names0);
    }
    const names = filterAlreadyExported(
        ctx,
        "menu",
        names0,
        readOnly ? false : options.skipExisting,
        (name) => menuExportReferencesExist(importJsonPath, name)
    );
    if (names.length === 0) {
        ctx.displayMessage(`&7No menus to ${readOnly ? "read" : "export"}.`);
        return { total: 0, succeeded: 0, failed: 0 };
    }

    ctx.displayMessage(
        `&a${verb} ${names.length} menu${names.length === 1 ? "" : "s"}...`
    );
    const { succeeded, failed } = await runReadLoop(ctx, {
        names,
        verb,
        progress: options.progress,
        processOne: async (ctx, name, onReadProgress) => {
            await exportMenu(
                ctx,
                { name, importJsonPath, rootDir, readOnly: options.readOnly, onReadProgress },
                { itemCaptures, writtenItems }
            );
        },
    });

    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${succeeded} of ${names.length} menu${names.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        return { total: names.length, succeeded, failed };
    }

    ctx.displayMessage(
        `&aExported ${succeeded} of ${names.length} menu${names.length === 1 ? "" : "s"} (${itemCaptures.size()} unique item${itemCaptures.size() === 1 ? "" : "s"})${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: names.length, succeeded, failed };
}
