import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { canonicalPath } from "../gui/parsing/parses";
import { getContainerBounds } from "../gui/lib/bounds";
import {
    closeConfirmPopover,
    openConfirmPopover,
} from "../gui/popovers/confirm";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { actionListsOfImportable } from "../importCache/actionLists";
import {
    houseLockAcceptsUpdate,
    houseLockEntryFor,
    readHouseLock,
    upsertHouseLockImportables,
} from "../importCache/houseLock";
import {
    cacheEntryHash,
    readImportableCache,
    writeImportableCache,
} from "../importCache/cache";
import { HOUSE_READERS } from "../importables/export/readers";
import { projectItemsFromParsedImportJson } from "../importables/export/projectDestination";
import { createProjectItemIndex } from "../importables/items/projectItems";
import {
    createItemDependencyIndex,
    sameItemDependencySnapshot,
    type ItemDependencyIndex,
} from "../importables/items/dependencyIndex";
import { importableIdentity, importableKey } from "../importables/identity";
import { resolveModuleRelativePath } from "../project/paths";
import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { stripSurroundingQuotes } from "../utils/helpers";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import { createDiffProgressSession } from "../gui/right-panel/import-tab/diffProgress";
import { writeDiffDetailsFile } from "./diffDetails";
import {
    evaluateDiffReport,
    formatDiffReport,
    collectDiffAdoptionLists,
    matchDiffActionLists,
    type DiffAdoptionList,
    type LiveDiffImportable,
} from "./diffReport";

function diffFailure(reason: string): void {
    ChatLib.chat(`[htsw] Diff failed: ${reason}`);
}

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function countBlockingDiagnostics(diagnostics: readonly Diagnostic[]): number {
    let count = 0;
    for (const diagnostic of diagnostics) {
        if (diagnostic.level === "error" || diagnostic.level === "bug") count++;
    }
    return count;
}

export async function readDiffImportables(
    ctx: TaskContext,
    manifest: string,
    housingUuid: string,
    parsed: ImportablesParseResult,
    progress: ReturnType<typeof createDiffProgressSession>,
    readers: Partial<typeof HOUSE_READERS> = HOUSE_READERS
): Promise<Map<string, LiveDiffImportable>> {
    const live = new Map<string, LiveDiffImportable>();
    const namesByType = new Map<Importable["type"], string[]>();
    for (const importable of parsed.value) {
        if (actionListsOfImportable(importable).length === 0) continue;
        const names = namesByType.get(importable.type);
        if (names === undefined) {
            namesByType.set(importable.type, [importableIdentity(importable)]);
        } else {
            names.push(importableIdentity(importable));
        }
    }

    for (const [type, names] of namesByType) {
        const reader = readers[type];
        if (reader === null || reader === undefined) continue;
        await reader(ctx, {
            importJsonPath: manifest,
            rootDir: "",
            projectItems: projectItemsFromParsedImportJson(parsed),
            names,
            quiet: true,
            progress: progress.sinkFor(type),
            output: {
                kind: "memory",
                housingUuid,
                accept: (importable, itemContent) => {
                    live.set(
                        importableKey(importable.type, importableIdentity(importable)),
                        { importable, itemContent }
                    );
                },
            },
        });
    }
    return live;
}

function formatDiffAdoptionLines(
    lists: readonly DiffAdoptionList[]
): string[] {
    const lines: string[] = [];
    const append = (
        reason: DiffAdoptionList["reason"],
        heading: string
    ): void => {
        const matching = lists.filter((list) => list.reason === reason);
        if (matching.length === 0) return;
        lines.push(heading);
        for (const list of matching) {
            lines.push(
                `${list.source.type} "${list.identity}" · ${list.basePath}`
            );
        }
    };
    append(
        "drifted",
        "Someone changed these since your last import:"
    );
    append(
        "untracked",
        "These have never been tracked by HTSW:"
    );
    return lines;
}

async function confirmDiffAdoption(
    ctx: TaskContext,
    lists: readonly DiffAdoptionList[]
): Promise<boolean> {
    if (getContainerBounds() === null) return false;
    let decision: boolean | null = null;
    const decide = (value: boolean): void => {
        if (decision === null) decision = value;
    };
    const currentDecision = (): boolean | null => decision;
    openConfirmPopover({
        title: "Adopt live Housing state?",
        lines: formatDiffAdoptionLines(lists),
        confirmLabel: "Adopt live state",
        cancelLabel: "Leave unchanged",
        onConfirm: () => decide(true),
        onClose: () => decide(false),
    });
    try {
        for (;;) {
            const current = currentDecision();
            if (current !== null) return current;
            await ctx.sleep(50);
        }
    } finally {
        closeConfirmPopover();
    }
}

function adoptDiffLists(
    ctx: TaskContext,
    manifest: string,
    housingUuid: string,
    lists: readonly DiffAdoptionList[],
    itemDependencies: ItemDependencyIndex
): void {
    if (!houseLockAcceptsUpdate(manifest, housingUuid)) {
        throw new Error("house.lock.json cannot be updated for this house");
    }
    const updates = new Map<
        string,
        {
            importable: Importable;
            itemContent: DiffAdoptionList["liveItemContent"];
            itemDependencies: ReturnType<ItemDependencyIndex["snapshotOf"]>;
        }
    >();
    for (const list of lists) {
        const key = importableKey(list.live.type, importableIdentity(list.live));
        if (!updates.has(key)) {
            updates.set(key, {
                importable: list.live,
                itemContent: list.liveItemContent,
                itemDependencies: itemDependencies.snapshotOf(list.live),
            });
        }
    }
    for (const update of updates.values()) {
        if (
            !writeImportableCache(
                ctx,
                housingUuid,
                update.importable,
                "reader",
                {
                    quiet: true,
                    itemDependencies: update.itemDependencies,
                }
            )
        ) {
            throw new Error(
                `could not cache ${update.importable.type} "${importableIdentity(update.importable)}"`
            );
        }
    }
    if (
        !upsertHouseLockImportables(
            manifest,
            housingUuid,
            Array.from(updates.values())
        )
    ) {
        throw new Error("could not update house.lock.json");
    }
    for (const update of updates.values()) {
        const identity = importableIdentity(update.importable);
        const cache = readImportableCache(
            housingUuid,
            update.importable.type,
            identity
        );
        const lock = houseLockEntryFor(
            readHouseLock(manifest),
            update.importable.type,
            identity
        );
        if (
            cache === null ||
            lock === null ||
            cacheEntryHash(cache) !== lock.hash ||
            !sameItemDependencySnapshot(
                cache.itemDependencies,
                lock.itemDependencies
            )
        ) {
            throw new Error(
                `cache and house lock did not match for ${update.importable.type} "${identity}"`
            );
        }
    }
}

export function commandDiff(args: string[]): void {
    const adoptWithoutPrompt = args.indexOf("--adopt") >= 0;
    const pathArgs = args.filter((arg) => arg !== "--adopt");
    if (pathArgs.length === 0) {
        diffFailure("expected a manifest path");
        return;
    }
    if (TaskManager.isBusy()) {
        diffFailure("another task is already running");
        return;
    }

    const manifest = canonicalPath(
        resolveModuleRelativePath(stripSurroundingQuotes(pathArgs.join(" ")))
    );
    if (!FileLib.exists(manifest)) {
        diffFailure(`file does not exist '${manifest}'`);
        return;
    }

    let parsed: ImportablesParseResult;
    try {
        parsed = parseImportablesResult(
            new SourceMap(new FileSystemFileLoader()),
            manifest
        );
    } catch (error) {
        diffFailure(errorReason(error));
        return;
    }
    const errorCount = countBlockingDiagnostics(parsed.diagnostics);
    if (errorCount > 0) {
        diffFailure(`manifest has ${errorCount} error${errorCount === 1 ? "" : "s"}`);
        return;
    }

    const progress = createDiffProgressSession(parsed.value, manifest);
    void runHousingSyncTask("diff", async (ctx) => {
        progress.start();
        const housingUuid = await getCurrentHousingUuid(ctx);
        const live = await readDiffImportables(
            ctx,
            manifest,
            housingUuid,
            parsed,
            progress
        );
        const matchedLists = matchDiffActionLists(parsed.value, live);
        const projectItems = createProjectItemIndex(parsed.value, parsed.gcx);
        const existingLock = readHouseLock(manifest);
        const report = evaluateDiffReport(
            housingUuid,
            matchedLists,
            existingLock,
            projectItems
        );
        for (const line of formatDiffReport(report, manifest)) {
            ChatLib.chat(line);
        }
        try {
            const detailsPath = writeDiffDetailsFile(
                report,
                manifest,
                new Date().toISOString()
            );
            ChatLib.chat(`[htsw] Diff details: ${detailsPath}`);
        } catch (error) {
            ChatLib.chat(
                `[htsw] Diff details not written: ${errorReason(error)}`
            );
        }
        const adoptionLists = collectDiffAdoptionLists(
            housingUuid,
            matchedLists,
            existingLock,
            projectItems
        );
        if (adoptionLists.length > 0) {
            const shouldAdopt =
                adoptWithoutPrompt ||
                (await confirmDiffAdoption(ctx, adoptionLists));
            if (shouldAdopt) {
                try {
                    adoptDiffLists(
                        ctx,
                        manifest,
                        housingUuid,
                        adoptionLists,
                        createItemDependencyIndex(parsed.value, projectItems)
                    );
                    ChatLib.chat(
                        `[htsw] Adopted ${adoptionLists.length} live action list${adoptionLists.length === 1 ? "" : "s"}`
                    );
                } catch (error) {
                    ChatLib.chat(
                        `[htsw] Adoption failed: ${errorReason(error)}`
                    );
                }
            } else if (getContainerBounds() === null) {
                ChatLib.chat(
                    "[htsw] Live state not adopted: no GUI available; rerun with --adopt to opt in"
                );
            }
        }
        progress.complete(
            `${report.clean} clean / ${report.conflicts.length} conflicts / ${report.unknown} unknown`
        );
        return true;
    })
        .then((completed) => {
            if (completed === undefined) progress.clear();
        })
        .catch((error: unknown) => {
            const reason = errorReason(error);
            progress.fail(reason);
            diffFailure(reason);
        });
}
