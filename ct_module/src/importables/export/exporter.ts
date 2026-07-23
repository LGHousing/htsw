import {
    restorePlayerInventory,
    snapshotPlayerInventory,
    type PlayerInventorySnapshot,
} from "../../housingSync/items/playerInventory";
import type { ProgressHandler } from "../../housingSync/progress/types";
import TaskContext from "../../tasks/context";
import { ItemCaptureRegistry } from "../items/captureRegistry";
import { exportCapturedItems } from "../items/exportCapturedItems";
import { filterAlreadyExported } from "./skip";
import { runReadLoop, type ReadFn, type ReadOptions } from "./reader";
import { readImportableCache, writeImportableCache } from "../../importCache/cache";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import { upsertHouseLockImportable } from "../../importCache/houseLock";
import type { Importable } from "htsw/types";
import {
    createExportItemCaptureRegistry,
    readParsedImportablesForExport,
} from "./projectDestination";
import { createProjectItemIndex } from "../items/projectItems";
import { createItemDependencyIndex } from "../items/dependencyIndex";
import { hasRequiredInteractDataCache } from "../items/interactDataCache";
import { importableIdentity } from "../identity";
import { exportedItemDependencies } from "../items/exportedDependencies";

// Scratch shared across every item in one export/read run: the dedup registry
// (seeded with the destination project's items so identical captures reuse
// project names), the set of item files already flushed this run, and the
// pre-run inventory to restore afterward. `inventorySnapshot` is non-null
// exactly when the spec sets `capturesActionItems` — the driver only disturbs
// the inventory for types whose items are pulled through it.
export type ExportReadState = {
    itemCaptures: ItemCaptureRegistry;
    menuSlotItemCaptures: ItemCaptureRegistry;
    writtenItems: Set<string>;
    inventorySnapshot: PlayerInventorySnapshot | null;
};

// One importable type's house-reading recipe. The driver owns everything that's
// identical across types (list, resume-skip, announce, per-item progress and
// counting, the item-capture/inventory lifecycle, the final report); a spec
// supplies only what genuinely differs. Export (write files) and deep read
// (cache only) are the same walk with different explicit output destinations.
type ImportableOfType<K extends Importable["type"]> = Extract<Importable, { type: K }>;

type HouseReader<Entry, Pending, Result> =
    | {
          kind: "direct";
          read: (
              ctx: TaskContext,
              entry: Entry,
              options: ReadOptions,
              state: ExportReadState,
              onReadProgress: ProgressHandler | undefined
          ) => Promise<Result>;
      }
    | {
          kind: "staged";
          scan: (
              ctx: TaskContext,
              entry: Entry,
              options: ReadOptions,
              state: ExportReadState,
              onReadProgress: ProgressHandler | undefined
          ) => Promise<Pending>;
          hydrate: (
              ctx: TaskContext,
              entry: Entry,
              pending: Pending,
              options: ReadOptions,
              state: ExportReadState,
              onReadProgress: ProgressHandler | undefined
          ) => Promise<Result>;
      };

export type HouseExporterRecipe<
    Entry,
    K extends Importable["type"],
    Pending = never,
    Result = ImportableOfType<K>,
> = {
    type: K;
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
    reader: HouseReader<Entry, Pending, Result>;
    importableOf: (result: Result) => ImportableOfType<K>;
    export: (
        ctx: TaskContext,
        entry: Entry,
        result: Result,
        options: ReadOptions,
        state: ExportReadState
    ) => Promise<void>;
    // Diagnostic messages emitted after the loop in both export and read modes,
    // before the summary line (e.g. item-capture hints).
    afterLoop?: (ctx: TaskContext, state: ExportReadState) => void;
    // Trailing "(...)" note on the export summary line, e.g. item counts. Include
    // the leading space.
    exportSummary?: (state: ExportReadState) => string;
};

const plural = (n: number): string => (n === 1 ? "" : "s");

export function refreshExportedItemDependencies(
    ctx: TaskContext,
    importJsonPath: string,
    housingUuid: string,
    type: Importable["type"],
    names: ReadonlySet<string>,
    verifiedItemNames: ReadonlySet<string>,
    updateHouseLock: boolean
): void {
    if (names.size === 0) return;
    const parsed = readParsedImportablesForExport(importJsonPath);
    if (parsed === null) return;
    const items = createProjectItemIndex(parsed.value, parsed.gcx);
    const dependencies = createItemDependencyIndex(parsed.value, items);

    for (const importable of parsed.value) {
        const identity = importableIdentity(importable);
        if (importable.type === type && names.has(identity)) {
            const cached = readImportableCache(housingUuid, type, identity);
            if (cached !== null) {
                const itemDependencies = exportedItemDependencies(
                    importable,
                    dependencies,
                    verifiedItemNames
                );
                writeImportableCache(ctx, housingUuid, cached.importable, cached.writer, {
                    quiet: true,
                    itemDependencies,
                });
                if (updateHouseLock) {
                    upsertHouseLockImportable(
                        importJsonPath,
                        housingUuid,
                        cached.importable,
                        itemDependencies
                    );
                }
            }
        }
        if (importable.type === "ITEM" && verifiedItemNames.has(identity)) {
            if (!hasRequiredInteractDataCache(importable, dependencies, housingUuid)) {
                continue;
            }
            const itemDependencies = exportedItemDependencies(
                importable,
                dependencies,
                verifiedItemNames
            );
            writeImportableCache(ctx, housingUuid, importable, "exporter", {
                quiet: true,
                itemDependencies,
            });
        }
    }
}

// Turn a per-type recipe into the `ReadFn` every caller (export batch, deep
// read, the test runner) already speaks.
export function defineHouseExporter<
    Entry,
    K extends Importable["type"],
    Pending = never,
    Result = ImportableOfType<K>,
>(spec: HouseExporterRecipe<Entry, K, Pending, Result>): ReadFn {
    const nameOf = spec.nameOf ?? ((entry: Entry) => entry as unknown as string);

    return async (ctx, options) => {
        const { importJsonPath } = options;
        const cacheOnly = options.output.kind === "cache";
        const verb = cacheOnly ? "Reading" : "Exporting";
        const lockHousingUuid =
            options.output.kind === "cache"
                ? options.output.housingUuid
                : await getCurrentHousingUuid(ctx);

        spec.prelude?.(ctx);

        const state: ExportReadState = {
            itemCaptures: createExportItemCaptureRegistry(
                importJsonPath,
                lockHousingUuid,
                options.projectItems
            ),
            menuSlotItemCaptures: new ItemCaptureRegistry("shell"),
            writtenItems: new Set<string>(),
            inventorySnapshot:
                spec.capturesActionItems === true ? snapshotPlayerInventory() : null,
        };
        const projectItems = options.projectItems ?? [];
        for (let i = 0; i < projectItems.length; i++) {
            state.menuSlotItemCaptures.seedNbtOnly(
                projectItems[i].name,
                projectItems[i].nbt
            );
        }

        const restoreInventory = async (): Promise<void> => {
            if (state.inventorySnapshot === null) return;
            try {
                await restorePlayerInventory(ctx, state.inventorySnapshot);
            } catch (error) {
                ctx.displayMessage(
                    `&7[export] &eInventory restore failed: ${String(error)}`
                );
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
            if (listed === null) {
                throw new Error(`Could not list ${spec.noun}s for export`);
            }
            names = listed.map(nameOf);
            options.onNamesListed?.(names);
        }

        const referencesExist = spec.referencesExist;
        const exportNames =
            referencesExist === undefined
                ? names
                : filterAlreadyExported(
                      ctx,
                      spec.noun,
                      names,
                      cacheOnly ? false : options.skipExisting,
                      (name) => referencesExist(importJsonPath, name)
                  );

        if (exportNames.length === 0) {
            ctx.displayMessage(`&7No ${spec.noun}s to ${cacheOnly ? "read" : "export"}.`);
            await restoreInventory();
            return { total: 0, succeeded: 0, failed: 0 };
        }

        ctx.displayMessage(
            `&a${verb} ${exportNames.length} ${spec.noun}${plural(exportNames.length)}...`
        );

        let succeeded = 0;
        let failed = 0;
        const completedNames = new Set<string>();
        try {
            const entryForName = (name: string): Entry => {
                const entry =
                    byName !== null ? byName.get(name) : (name as unknown as Entry);
                if (entry === undefined) {
                    throw new Error(
                        `No ${spec.noun} named "${name}" exists in this housing.`
                    );
                }
                return entry;
            };
            const accept = async (
                acceptCtx: TaskContext,
                name: string,
                result: Result
            ): Promise<void> => {
                const entry = entryForName(name);
                const importable = spec.importableOf(result);
                if (options.output.kind === "cache") {
                    writeImportableCache(
                        acceptCtx,
                        options.output.housingUuid,
                        importable,
                        "reader",
                        true
                    );
                } else {
                    await spec.export(acceptCtx, entry, result, options, state);
                }
                completedNames.add(name);
                if (!cacheOnly) {
                    const cached = readImportableCache(
                        lockHousingUuid,
                        spec.type,
                        name
                    );
                    if (cached !== null) {
                        upsertHouseLockImportable(
                            options.importJsonPath,
                            lockHousingUuid,
                            cached.importable
                        );
                    }
                }
            };
            const common = {
                names: exportNames,
                verb,
                displayName: spec.displayName,
                progress: options.progress,
                accept,
            };
            const reader = spec.reader;
            const result =
                reader.kind === "direct"
                    ? await runReadLoop(ctx, {
                          ...common,
                          reader: {
                              kind: "direct",
                              read: (readCtx, name, onReadProgress) =>
                                  reader.read(
                                      readCtx,
                                      entryForName(name),
                                      options,
                                      state,
                                      onReadProgress
                                  ),
                          },
                      })
                    : await runReadLoop(ctx, {
                          ...common,
                          reader: {
                              kind: "staged",
                              scan: (scanCtx, name, onReadProgress) =>
                                  reader.scan(
                                      scanCtx,
                                      entryForName(name),
                                      options,
                                      state,
                                      onReadProgress
                                  ),
                              hydrate: (
                                  hydrateCtx,
                                  name,
                                  pending,
                                  onReadProgress
                              ) =>
                                  reader.hydrate(
                                      hydrateCtx,
                                      entryForName(name),
                                      pending,
                                      options,
                                      state,
                                      onReadProgress
                                  ),
                          },
                      });
            succeeded = result.succeeded;
            failed = result.failed;
        } finally {
            try {
                if (!cacheOnly && spec.capturesActionItems === true) {
                    await exportCapturedItems(
                        ctx,
                        state.itemCaptures,
                        options.rootDir,
                        importJsonPath,
                        lockHousingUuid,
                        options.newExportTargetImportJson
                    );
                }
                if (spec.capturesActionItems === true) {
                    const verifiedItemNames = new Set(
                        cacheOnly
                            ? state.itemCaptures.matchedItemNames()
                            : state.itemCaptures.capturedItemNames()
                    );
                    refreshExportedItemDependencies(
                        ctx,
                        importJsonPath,
                        lockHousingUuid,
                        spec.type,
                        completedNames,
                        verifiedItemNames,
                        !cacheOnly
                    );
                }
            } finally {
                await restoreInventory();
            }
        }

        const failedNote = failed > 0 ? ` &c[${failed} failed]` : "";
        spec.afterLoop?.(ctx, state);
        if (cacheOnly) {
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
