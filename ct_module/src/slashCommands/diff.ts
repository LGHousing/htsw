import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";
import {
    emitBridgeEvent,
    rejectBridgeRun,
    setBridgeConflictDetails,
} from "@htsw/importer/bridge/status";

import { canonicalPath, parseImportJsonCurrent } from "@htsw/importer/runtime/parsing/parses";
import { openAnswerableConflictPrompt } from "@htsw/importer/runtime/conflictPrompt";
import { getCurrentHousingUuid } from "@htsw/importer/importCache/housingId";
import { actionListsOfImportable } from "@htsw/importer/importCache/actionLists";
import {
    houseLockAcceptsUpdate,
    houseLockEntryFor,
    readHouseLock,
    upsertHouseLockImportables,
} from "@htsw/importer/importCache/houseLock";
import {
    cacheEntryHash,
    readImportableCache,
    writeImportableCache,
} from "@htsw/importer/importCache/cache";
import { HOUSE_READERS } from "@htsw/importer/importables/export/readers";
import { projectItemsFromParsedImportJson } from "@htsw/importer/importables/export/projectDestination";
import { createProjectItemIndex } from "@htsw/importer/importables/items/projectItems";
import {
    createItemDependencyIndex,
    sameItemDependencySnapshot,
    type ItemDependencyIndex,
} from "@htsw/importer/importables/items/dependencyIndex";
import { importableIdentity, importableKey } from "@htsw/importer/importables/identity";
import { resolveModuleRelativePath } from "@htsw/importer/project/paths";
import { TaskManager } from "@htsw/importer/tasks/manager";
import type TaskContext from "@htsw/importer/tasks/context";
import { blockingDiagnostics, errorMessage, stripSurroundingQuotes } from "@htsw/importer/utils/helpers";
import { runHousingSyncTask } from "@htsw/importer/housingSync/taskRunner";
import { createDiffProgressSession } from "@htsw/importer/runtime/diffProgress";
import { writeDiffDetailsFile } from "@htsw/importer/housingSync/actions/diffDetails";
import {
    appendGroupDiffReport,
    evaluateDiffReport,
    formatDiffReport,
    matchDiffActionLists,
    type DiffAdoptionList,
    type LiveDiffImportable,
} from "./diffReport";

function diffFailure(reason: string): void {
    rejectBridgeRun("diff", reason, "htsw_diff");
    ChatLib.chat(`[htsw] Diff failed: ${reason}`);
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
        if (
            importable.type !== "GROUP" &&
            actionListsOfImportable(importable).length === 0
        )
            continue;
        const names = namesByType.get(importable.type);
        if (names === undefined) {
            namesByType.set(importable.type, [importableIdentity(importable)]);
        } else {
            names.push(importableIdentity(importable));
        }
    }

    for (const [type, names] of namesByType) {
        const reader = readers[type];
        if (reader === undefined) continue;
        await reader(ctx, {
            importJsonPath: manifest,
            rootDir: "",
            projectItems: projectItemsFromParsedImportJson(parsed),
            parsed,
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

function diffAdoptionChatMessage(lists: readonly DiffAdoptionList[]): string {
    const differenceVerb = lists.length === 1 ? "differs" : "differ";
    return (
        `[htsw] Diff conflict: ${lists.length} live action list${lists.length === 1 ? "" : "s"} ` +
        `${differenceVerb} from tracked state — awaiting confirmation\n` +
        lists
            .map(
                (list) =>
                    `[htsw] Conflict: ${list.source.type} "${list.identity}" · ${list.basePath}`
            )
            .join("\n")
    );
}

async function confirmDiffAdoption(
    ctx: TaskContext,
    lists: readonly DiffAdoptionList[]
): Promise<boolean> {
    return openAnswerableConflictPrompt(ctx, {
        chatMessage: diffAdoptionChatMessage(lists),
        chatConfirmAction: "adopt live state",
        chatRefuseAction: "leave it unchanged",
        title: "Adopt live Housing state?",
        lines: formatDiffAdoptionLines(lists),
        confirmLabel: "Adopt live state",
        cancelLabel: "Leave unchanged",
    });
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

    // Reserve the task before yielding so another command cannot start during parsing.
    let progress: ReturnType<typeof createDiffProgressSession> | null = null;
    void runHousingSyncTask(
        "diff",
        async (ctx) => {
            const entry = await parseImportJsonCurrent(manifest);
            ctx.checkCancelled();
            if (entry.parsed === null) throw new Error(entry.error ?? "parse failed");
            const parsed = entry.parsed;
            const errorCount = blockingDiagnostics(parsed.diagnostics).length;
            if (errorCount > 0) {
                throw new Error(`manifest has ${errorCount} error${errorCount === 1 ? "" : "s"}`);
            }
            progress = createDiffProgressSession(parsed.value, manifest);
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
            const { report, adoptionLists } = evaluateDiffReport(
                housingUuid,
                matchedLists,
                existingLock,
                projectItems
            );
            appendGroupDiffReport(report, parsed.value, live);
            emitBridgeEvent("htsw_diff", {
                status: "completed",
                clean: report.clean,
                conflicts: report.conflicts.length,
                unknown: report.unknown,
                manifest,
            });
            setBridgeConflictDetails({
                conflicts: adoptionLists.map((list) => ({
                    type: list.source.type,
                    identity: list.identity,
                    basePath: list.basePath,
                })),
            });
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
                emitBridgeEvent("htsw_diff", { status: "details", path: detailsPath });
                setBridgeConflictDetails({
                    conflicts: adoptionLists.map((list) => ({
                        type: list.source.type,
                        identity: list.identity,
                        basePath: list.basePath,
                    })),
                    diffPath: detailsPath,
                });
            } catch (error) {
                ChatLib.chat(`[htsw] Diff details not written: ${errorMessage(error)}`);
            }
            if (adoptionLists.length > 0) {
                const shouldAdopt =
                    adoptWithoutPrompt || (await confirmDiffAdoption(ctx, adoptionLists));
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
                        ChatLib.chat(`[htsw] Adoption failed: ${errorMessage(error)}`);
                    }
                }
            }
            progress.complete(
                `${report.clean} clean / ${report.conflicts.length} conflicts / ${report.unknown} unknown`
            );
            return true;
        },
        { diagnostic: "htsw_diff" }
    )
        .then((completed) => {
            if (completed === undefined) progress?.clear();
        })
        .catch((error: unknown) => {
            const reason = errorMessage(error);
            progress?.fail(reason);
            ChatLib.chat(`[htsw] Diff failed: ${reason}`);
        });
}
