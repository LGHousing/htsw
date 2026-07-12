import type { ImportableItem } from "htsw/types";

import type TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { waitIfStepPaused } from "../housingSync/stepGate";
import type {
    ExportProgressSink,
    ProgressHandler,
} from "../housingSync/progress/types";

export type ReadResult = { total: number; succeeded: number; failed: number };

/**
 * Options for a per-type house batch read (`readFunctions`, `readCommands`, ...). Every batch walks the house's editors and reads
 * full content; the options decide where the result goes — project files
 * (export) or, with `readOnly`, only the house knowledge cache (deep read).
 */
export type ReadOptions = {
    importJsonPath: string;
    rootDir: string;
    // Sticky "new exports land here" file for this destination. Only redirects
    // importables that aren't already declared somewhere in the include tree,
    // and only when it's reachable from `importJsonPath`. Omitted = the default
    // declared/section-folder/base routing.
    newExportTargetImportJson?: string;
    // Limit the batch to these names; omitted = list and process the whole house.
    names?: readonly string[];
    progress?: ExportProgressSink;
    // Read-only (deep read): cache what the house contains, write no files.
    readOnly?: { housingUuid: string };
    // Items the destination project already declares; seeds the capture
    // registry so identical captures reuse project names instead of minting
    // duplicates. Callers with a warm parse should always pass this.
    projectItems?: readonly ImportableItem[];
    // Fires when the batch listed the house's names itself (no `names`
    // supplied), so the caller can record the scan.
    onNamesListed?: (names: readonly string[]) => void;
    skipExisting?: boolean;
};

export type ReadFn = (
    ctx: TaskContext,
    options: ReadOptions
) => Promise<ReadResult>;

export type ReadLoopParams = {
    // Names to process — already listed and skip-filtered by the caller. Drives
    // the progress rows and the per-item order.
    names: readonly string[];
    // "Exporting" for a real export, "Reading" for a read-only (deep read) pass.
    verb: string;
    // How a name reads in log lines; commands render as "/name". Identity default.
    displayName?: (name: string) => string;
    progress?: ExportProgressSink;
    // The per-item work: read the item and write its files (or cache it, in
    // read-only mode). Throwing marks the item failed; throwing a cancellation
    // aborts the whole batch.
    processOne: (
        ctx: TaskContext,
        name: string,
        onReadProgress: ProgressHandler | undefined
    ) => Promise<void>;
    scanOne?: (
        ctx: TaskContext,
        name: string,
        onReadProgress: ProgressHandler | undefined
    ) => Promise<unknown>;
    hydrateOne?: (
        ctx: TaskContext,
        name: string,
        pending: unknown,
        onReadProgress: ProgressHandler | undefined
    ) => Promise<void>;
};

// The shared batch loop: owns the progress-sink lifecycle, cancellation, and
// success/failure counting for every importable type. Per-type differences
// (listing, skip rules, item capture, file layout, read-only caching) live in
// the caller and its `processOne` closure.
export async function runReadLoop(
    ctx: TaskContext,
    params: ReadLoopParams
): Promise<{ succeeded: number; failed: number }> {
    const { names, verb, progress, processOne, scanOne, hydrateOne } = params;
    const shown = (name: string): string =>
        params.displayName !== undefined ? params.displayName(name) : name;

    progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        if (scanOne !== undefined && hydrateOne !== undefined) {
            const pending: Array<unknown | null> = names.map(() => null);
            progress?.scanStarted?.();
            for (let i = 0; i < names.length; i++) {
                ctx.checkCancelled();
                await waitIfStepPaused(ctx);
                const name = names[i];
                progress?.item(i, name);
                ctx.displayMessage(`&7[${i + 1}/${names.length}] &fScanning '${shown(name)}'`);
                const sink = progress;
                try {
                    pending[i] = await scanOne(
                        ctx,
                        name,
                        sink?.itemProgress === undefined
                            ? undefined
                            : (payload) => sink.itemProgress!(i, payload)
                    );
                } catch (error) {
                    if (isTaskCancelled(error)) throw error;
                    pending[i] = null;
                    failed++;
                    sink?.itemFailed?.(i, String(error));
                    ctx.displayMessage(`&c[export-all] failed on '${shown(name)}': ${error}`);
                }
            }
            for (let i = 0; i < names.length; i++) {
                if (pending[i] === null) continue;
                ctx.checkCancelled();
                await waitIfStepPaused(ctx);
                const name = names[i];
                progress?.itemReactivated?.(i);
                ctx.displayMessage(`&7[${i + 1}/${names.length}] &f${verb} '${shown(name)}'`);
                const sink = progress;
                try {
                    await hydrateOne(
                        ctx,
                        name,
                        pending[i],
                        sink?.itemProgress === undefined
                            ? undefined
                            : (payload) => sink.itemProgress!(i, payload)
                    );
                    succeeded++;
                    sink?.itemFinished?.(i);
                } catch (error) {
                    if (isTaskCancelled(error)) throw error;
                    failed++;
                    sink?.itemFailed?.(i, String(error));
                    ctx.displayMessage(`&c[export-all] failed on '${shown(name)}': ${error}`);
                }
            }
            return { succeeded, failed };
        }
        for (let i = 0; i < names.length; i++) {
            ctx.checkCancelled();
            await waitIfStepPaused(ctx);
            const name = names[i];

            progress?.item(i, name);
            ctx.displayMessage(
                `&7[${i + 1}/${names.length}] &f${verb} '${shown(name)}'`
            );

            const sink = progress;
            try {
                await processOne(
                    ctx,
                    name,
                    sink?.itemProgress === undefined
                        ? undefined
                        : (payload) => sink.itemProgress!(i, payload)
                );
                succeeded++;
                sink?.itemFinished?.(i);
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                sink?.itemFailed?.(i, String(error));
                ctx.displayMessage(
                    `&c[export-all] failed on '${shown(name)}': ${error}`
                );
            }
        }
    } finally {
        progress?.done();
    }

    return { succeeded, failed };
}
