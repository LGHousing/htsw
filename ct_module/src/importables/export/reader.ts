import type { Importable, ImportableItem } from "htsw/types";

import type TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import type {
    ExportProgressSink,
    ProgressHandler,
} from "../../housingSync/progress/types";
import type { CapturedItem } from "../items/captureRegistry";

export type ReadResult = { total: number; succeeded: number; failed: number };

export type ReadOutput =
    | { kind: "project" }
    | { kind: "cache"; housingUuid: string }
    | {
      kind: "memory";
      housingUuid: string;
      accept: (importable: Importable) => void;
      acceptItemCaptures?: (items: readonly CapturedItem[]) => void;
      };

/**
 * Options for a per-type house batch read (`readFunctions`, `readCommands`, ...). Every batch walks the house's editors and reads
 * full content; the options decide where the result goes — project files
 * (export) or only the house knowledge cache (deep read).
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
    output: ReadOutput;
    // Items the destination project already declares; seeds the capture
    // registry so identical captures reuse project names instead of minting
    // duplicates. Callers with a warm parse should always pass this.
    projectItems?: readonly ImportableItem[];
    // Fires when the batch listed the house's names itself (no `names`
    // supplied), so the caller can record the scan.
    onNamesListed?: (names: readonly string[]) => void;
    skipExisting?: boolean;
    quiet?: boolean;
};

export type ReadFn = (ctx: TaskContext, options: ReadOptions) => Promise<ReadResult>;

type ReadLoopBase<Result> = {
    // Names to process — already listed and skip-filtered by the caller. Drives
    // the progress rows and the per-item order.
    names: readonly string[];
    // "Exporting" for a real export, "Reading" for a read-only (deep read) pass.
    verb: string;
    // How a name reads in log lines; commands render as "/name". Identity default.
    displayName?: (name: string) => string;
    progress?: ExportProgressSink;
    quiet?: boolean;
    accept: (ctx: TaskContext, name: string, result: Result) => Promise<void>;
};

type DirectReadLoopParams<Result> = ReadLoopBase<Result> & {
    reader: {
        kind: "direct";
        read: (
            ctx: TaskContext,
            name: string,
            onReadProgress: ProgressHandler | undefined
        ) => Promise<Result>;
    };
};

type StagedReadLoopParams<Pending, Result> = ReadLoopBase<Result> & {
    reader: {
        kind: "staged";
        scan: (
            ctx: TaskContext,
            name: string,
            onReadProgress: ProgressHandler | undefined
        ) => Promise<Pending>;
        hydrate: (
            ctx: TaskContext,
            name: string,
            pending: Pending,
            onReadProgress: ProgressHandler | undefined
        ) => Promise<Result>;
    };
};

export type ReadLoopParams<Pending, Result> =
    DirectReadLoopParams<Result> | StagedReadLoopParams<Pending, Result>;

type PendingRead<Pending> = { kind: "ready"; value: Pending } | { kind: "failed" };

async function readAndAccept<Result>(
    ctx: TaskContext,
    name: string,
    read: (
        ctx: TaskContext,
        name: string,
        onReadProgress: ProgressHandler | undefined
    ) => Promise<Result>,
    accept: (ctx: TaskContext, name: string, result: Result) => Promise<void>,
    onReadProgress: ProgressHandler | undefined
): Promise<void> {
    const result = await read(ctx, name, onReadProgress);
    await accept(ctx, name, result);
}

// The shared batch loop owns the progress lifecycle, cancellation, and result
// counting. Per-type listing, capture, and output behavior lives in the exporter recipe.
export async function runReadLoop<Pending, Result>(
    ctx: TaskContext,
    params: ReadLoopParams<Pending, Result>
): Promise<{ succeeded: number; failed: number }> {
    const { names, verb, progress, reader, accept, quiet } = params;
    const shown = (name: string): string =>
        params.displayName !== undefined ? params.displayName(name) : name;

    progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        if (reader.kind === "staged") {
            const pending: PendingRead<Pending>[] = names.map(() => ({
                kind: "failed",
            }));
            progress?.scanStarted?.();
            for (let i = 0; i < names.length; i++) {
                ctx.checkCancelled();
                const name = names[i];
                progress?.item(i, name);
                if (quiet !== true) {
                    ctx.displayMessage(
                        `&7[${i + 1}/${names.length}] &fScanning '${shown(name)}'`
                    );
                }
                const sink = progress;
                const itemProgress = sink?.itemProgress?.bind(sink);
                try {
                    pending[i] = {
                        kind: "ready",
                        value: await reader.scan(
                            ctx,
                            name,
                            itemProgress === undefined
                                ? undefined
                                : (payload) => itemProgress(i, payload)
                        ),
                    };
                } catch (error) {
                    if (isTaskCancelled(error)) throw error;
                    pending[i] = { kind: "failed" };
                    failed++;
                    sink?.itemFailed?.(i, String(error));
                    if (quiet !== true) {
                        ctx.displayMessage(
                            `&c[export-all] failed on '${shown(name)}': ${String(error)}`
                        );
                    }
                }
            }
            for (let i = 0; i < names.length; i++) {
                const pendingRead = pending[i];
                if (pendingRead.kind === "failed") continue;
                ctx.checkCancelled();
                const name = names[i];
                progress?.itemReactivated?.(i);
                if (quiet !== true) {
                    ctx.displayMessage(
                        `&7[${i + 1}/${names.length}] &f${verb} '${shown(name)}'`
                    );
                }
                const sink = progress;
                const itemProgress = sink?.itemProgress?.bind(sink);
                try {
                    await readAndAccept(
                        ctx,
                        name,
                        (ctx, name, onProgress) =>
                            reader.hydrate(ctx, name, pendingRead.value, onProgress),
                        accept,
                        itemProgress === undefined
                            ? undefined
                            : (payload) => itemProgress(i, payload)
                    );
                    succeeded++;
                    sink?.itemFinished?.(i);
                } catch (error) {
                    if (isTaskCancelled(error)) throw error;
                    failed++;
                    sink?.itemFailed?.(i, String(error));
                    if (quiet !== true) {
                        ctx.displayMessage(
                            `&c[export-all] failed on '${shown(name)}': ${String(error)}`
                        );
                    }
                }
            }
            return { succeeded, failed };
        }
        for (let i = 0; i < names.length; i++) {
            ctx.checkCancelled();
            const name = names[i];

            progress?.item(i, name);
            if (quiet !== true) {
                ctx.displayMessage(
                    `&7[${i + 1}/${names.length}] &f${verb} '${shown(name)}'`
                );
            }

            const sink = progress;
            const itemProgress = sink?.itemProgress?.bind(sink);
            try {
                await readAndAccept(
                    ctx,
                    name,
                    reader.read,
                    accept,
                    itemProgress === undefined
                        ? undefined
                        : (payload) => itemProgress(i, payload)
                );
                succeeded++;
                sink?.itemFinished?.(i);
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                sink?.itemFailed?.(i, String(error));
                if (quiet !== true) {
                    ctx.displayMessage(
                        `&c[export-all] failed on '${shown(name)}': ${String(error)}`
                    );
                }
            }
        }
    } finally {
        progress?.done();
    }

    return { succeeded, failed };
}
