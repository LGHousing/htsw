import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../housingSync/itemCapture";
import type { ProgressHandler } from "../housingSync/progress/types";
import TaskContext from "../tasks/context";
import { writeCapturedItems } from "./items/writeCapturedItems";
import { filterAlreadyExported } from "./exportSkip";
import { runReadLoop, type ReadFn, type ReadOptions } from "./read";
import { readImportableCache } from "../importCache/cache";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { upsertHouseLockImportable } from "../importCache/houseLock";
import type { Importable } from "htsw/types";

// Scratch shared across every item in one export/read run: the dedup registry
// (seeded with the destination project's items so identical captures reuse
// project names), the set of item files already flushed this run, and the
// pre-run inventory to restore afterward. `inventorySnapshot` is non-null
// exactly when the spec sets `capturesActionItems` — the driver only disturbs
// the inventory for types whose items are pulled through it.
export type BatchState = {
    itemCaptures: ItemCaptureRegistry;
    writtenItems: Set<string>;
    inventorySnapshot: InventorySnapshot | null;
};

// One importable type's house-reading recipe. The driver owns everything that's
// identical across types (list, resume-skip, announce, per-item progress and
// counting, the item-capture/inventory lifecycle, the final report); a spec
// supplies only what genuinely differs. Export (write files) and deep read
// (cache only) are the same walk — `options.readOnly` picks the sink inside
// `readOne`.
export type ReadHouseSpec<Entry> = {
    type: Importable["type"];
    // Singular, lowercase; pluralized with a trailing "s" in messages.
    noun: string;
    // Enumerate the house's entries of this type. Called to derive names when
    // the caller passed none, and always when `alwaysList` is set.
    list: (ctx: TaskContext) => Promise<readonly Entry[]>;
    // Entry -> its house name. Omit when entries already are names (Entry = string).
    nameOf?: (entry: Entry) => string;
    // How a name reads in log lines (commands render as "/name"). Identity default.
    displayName?: (name: string) => string;
    // Whether `name`'s export is already fully on disk; drives resume-skip. Omit
    // for types with no on-disk references to resume from (e.g. teams).
    referencesExist?: (importJsonPath: string, name: string) => boolean;
    // The item read path disturbs the player inventory: snapshot before the run,
    // flush captured items and restore after. Off for types that read item NBT
    // directly (menus) or hold no items (teams).
    capturesActionItems?: boolean;
    // Force listing even when the caller supplied `names`, because the per-item
    // body needs data only the listing carries (regions need bounds).
    alwaysList?: boolean;
    // Runs once before the batch, even when `names` was supplied — resets a
    // list-session cache so per-item reads reflect the live house.
    prelude?: (ctx: TaskContext) => void;
    // Read one entry from the house and land it: import.json + files on export,
    // cache only when `options.readOnly` is set.
    readOne: (
        ctx: TaskContext,
        entry: Entry,
        options: ReadOptions,
        state: BatchState,
        onReadProgress: ProgressHandler | undefined
    ) => Promise<void>;
    scanOne?: (ctx: TaskContext, entry: Entry, options: ReadOptions, state: BatchState, onReadProgress: ProgressHandler | undefined) => Promise<unknown>;
    hydrateOne?: (ctx: TaskContext, entry: Entry, pending: unknown, options: ReadOptions, state: BatchState, onReadProgress: ProgressHandler | undefined) => Promise<void>;
    // Diagnostic messages emitted after the loop in both export and read modes,
    // before the summary line (e.g. item-capture hints).
    afterLoop?: (ctx: TaskContext, state: BatchState) => void;
    // Trailing "(...)" note on the export summary line, e.g. item counts. Include
    // the leading space.
    exportSummary?: (state: BatchState) => string;
};

const plural = (n: number): string => (n === 1 ? "" : "s");

// Turn a per-type recipe into the `ReadFn` every caller (export batch, deep
// read, the test runner) already speaks.
export function makeReadHouse<Entry>(spec: ReadHouseSpec<Entry>): ReadFn {
    const nameOf = spec.nameOf ?? ((entry: Entry) => entry as unknown as string);

    return async (ctx, options) => {
        const { importJsonPath } = options;
        const readOnly = options.readOnly !== undefined;
        const verb = readOnly ? "Reading" : "Exporting";
        const lockHousingUuid =
            options.readOnly?.housingUuid ?? (await getCurrentHousingUuid(ctx));

        spec.prelude?.(ctx);

        const state: BatchState = {
            itemCaptures: new ItemCaptureRegistry(),
            writtenItems: new Set<string>(),
            inventorySnapshot: spec.capturesActionItems === true ? snapshotInventory() : null,
        };
        const projectItems = options.projectItems ?? [];
        for (let i = 0; i < projectItems.length; i++) {
            state.itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
        }

        const restoreInventory = async (): Promise<void> => {
            if (state.inventorySnapshot === null) return;
            try {
                await restoreInventoryToSnapshot(ctx, state.inventorySnapshot);
            } catch (error) {
                ctx.displayMessage(`&7[export] &eInventory restore failed: ${error}`);
            }
        };

        const listed =
            options.names === undefined || spec.alwaysList === true
                ? await spec.list(ctx)
                : null;
        const byName =
            listed !== null
                ? new Map(listed.map((entry) => [nameOf(entry), entry] as const))
                : null;

        let names: readonly string[];
        if (options.names !== undefined) {
            names = options.names;
        } else {
            names = listed!.map(nameOf);
            options.onNamesListed?.(names);
        }

        const exportNames =
            spec.referencesExist === undefined
                ? names
                : filterAlreadyExported(
                      ctx,
                      spec.noun,
                      names,
                      readOnly ? false : options.skipExisting,
                      (name) => spec.referencesExist!(importJsonPath, name)
                  );

        if (exportNames.length === 0) {
            ctx.displayMessage(`&7No ${spec.noun}s to ${readOnly ? "read" : "export"}.`);
            await restoreInventory();
            return { total: 0, succeeded: 0, failed: 0 };
        }

        ctx.displayMessage(
            `&a${verb} ${exportNames.length} ${spec.noun}${plural(exportNames.length)}...`
        );

        let succeeded = 0;
        let failed = 0;
        try {
            const result = await runReadLoop(ctx, {
                names: exportNames,
                verb,
                displayName: spec.displayName,
                progress: options.progress,
                processOne: async (ctx, name, onReadProgress) => {
                    const entry = byName !== null ? byName.get(name) : (name as unknown as Entry);
                    if (entry === undefined) {
                        throw new Error(
                            `No ${spec.noun} named "${name}" exists in this housing.`
                        );
                    }
                    await spec.readOne(ctx, entry, options, state, onReadProgress);
                    const cached = readImportableCache(lockHousingUuid, spec.type, name);
                    if (cached !== null) {
                        upsertHouseLockImportable(
                            options.importJsonPath,
                            lockHousingUuid,
                            cached.importable
                        );
                    }
                },
                ...(spec.scanOne === undefined || spec.hydrateOne === undefined ? {} : {
                    scanOne: async (ctx: TaskContext, name: string, onReadProgress: ProgressHandler | undefined) => {
                        const entry = byName !== null ? byName.get(name) : (name as unknown as Entry);
                        if (entry === undefined) throw new Error(`No ${spec.noun} named "${name}" exists in this housing.`);
                        return spec.scanOne!(ctx, entry, options, state, onReadProgress);
                    },
                    hydrateOne: async (ctx: TaskContext, name: string, pending: unknown, onReadProgress: ProgressHandler | undefined) => {
                        const entry = byName !== null ? byName.get(name) : (name as unknown as Entry);
                        if (entry === undefined) throw new Error(`No ${spec.noun} named "${name}" exists in this housing.`);
                        await spec.hydrateOne!(ctx, entry, pending, options, state, onReadProgress);
                        const cached = readImportableCache(lockHousingUuid, spec.type, name);
                        if (cached !== null) upsertHouseLockImportable(options.importJsonPath, lockHousingUuid, cached.importable);
                    },
                }),
            });
            succeeded = result.succeeded;
            failed = result.failed;
        } finally {
            try {
                if (!readOnly && spec.capturesActionItems === true) {
                    await writeCapturedItems(
                        ctx,
                        state.itemCaptures,
                        options.rootDir,
                        importJsonPath,
                        options.newExportTargetImportJson
                    );
                }
            } finally {
                await restoreInventory();
            }
        }

        const failedNote = failed > 0 ? ` &c[${failed} failed]` : "";
        spec.afterLoop?.(ctx, state);
        if (readOnly) {
            ctx.displayMessage(
                `&aRead ${succeeded} of ${exportNames.length} ${spec.noun}${plural(exportNames.length)}${failedNote}`
            );
            return { total: exportNames.length, succeeded, failed };
        }

        const summary = spec.exportSummary?.(state) ?? "";
        ctx.displayMessage(
            `&aExported ${succeeded} of ${exportNames.length} ${spec.noun}${plural(exportNames.length)}${summary}${failedNote}`
        );
        ctx.displayMessage(`&7  -> ${importJsonPath}`);
        return { total: exportNames.length, succeeded, failed };
    };
}
