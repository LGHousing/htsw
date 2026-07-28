import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { canonicalPath } from "../gui/parsing/parses";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { actionListsOfImportable } from "../importCache/actionLists";
import { readHouseLock, seedMissingHouseLockActionLists } from "../importCache/houseLock";
import { writeStagedActionListHydration } from "../importCache/stagedHydration";
import { HOUSE_READERS } from "../importables/export/readers";
import { projectItemsFromParsedImportJson } from "../importables/export/projectDestination";
import { createProjectItemIndex } from "../importables/items/projectItems";
import type { CapturedItem } from "../importables/items/captureRegistry";
import { capturedItemFieldContent } from "../housingSync/items/fieldContent";
import { importableIdentity, importableKey } from "../importables/identity";
import { resolveModuleRelativePath } from "../project/paths";
import { isTaskCancelled, TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { stripSurroundingQuotes } from "../utils/helpers";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import {
    packageBaselineAgeDays,
    readPackageBaselineStamp,
} from "../importables/baselineStamp";
import { createDiffProgressSession } from "../gui/right-panel/import-tab/diffProgress";
import { writeDiffDetailsFile } from "./diffDetails";
import {
    evaluateDiffReport,
    formatDiffReport,
    matchedLiveActionLists,
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

async function readDiffImportables(
    ctx: TaskContext,
    manifest: string,
    housingUuid: string,
    parsed: ImportablesParseResult,
    progress: ReturnType<typeof createDiffProgressSession>
): Promise<Map<string, Importable>> {
    const live = new Map<string, Importable>();
    const captures = new Map<string, CapturedItem>();
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
        const reader = HOUSE_READERS[type];
        if (reader === null) continue;
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
                accept: (importable) => {
                    live.set(
                        importableKey(importable.type, importableIdentity(importable)),
                        importable
                    );
                },
                acceptItemCaptures: (items) => {
                    for (const item of items) captures.set(item.name, item);
                },
            },
        });
    }
    diffItemCaptures.set(live, captures);
    return live;
}

const diffItemCaptures = new WeakMap<
    Map<string, Importable>,
    Map<string, CapturedItem>
>();

export function commandDiff(args: string[]): void {
    if (args.length === 0) {
        diffFailure("expected a manifest path");
        return;
    }
    if (TaskManager.isBusy()) {
        diffFailure("another task is already running");
        return;
    }

    const manifest = canonicalPath(
        resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")))
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
    void runHousingSyncTask("export", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const live = await readDiffImportables(
            ctx,
            manifest,
            housingUuid,
            parsed,
            progress
        );
        const matchedLists = matchedLiveActionLists(parsed.value, live);
        const captures = diffItemCaptures.get(live) ?? new Map();
        const projectItems = createProjectItemIndex(parsed.value, parsed.gcx);
        const existingLock = readHouseLock(manifest);
        for (const list of matchedLists) {
            const liveItemContent = capturedItemFieldContent(list.live, captures);
            writeStagedActionListHydration(
                housingUuid,
                list.source.type,
                list.identity,
                list.basePath,
                list.actions,
                liveItemContent
            );
        }
        seedMissingHouseLockActionLists(
            manifest,
            housingUuid,
            matchedLists.map((list) => ({
                importable: list.live,
                basePath: list.basePath,
                actions: list.actions,
                itemContent: capturedItemFieldContent(list.live, captures),
            }))
        );
        const report = evaluateDiffReport(housingUuid, parsed.value, live, existingLock, {
            projectItems,
            captures,
        });
        report.staleBaselineDays = packageBaselineAgeDays(
            readPackageBaselineStamp(manifest)
        );
        const detailsPath =
            report.conflicts.length === 0 &&
            (report.pendingChanges?.length ?? 0) === 0 &&
            report.staleBaselineDays === undefined &&
            (report.revertCount ?? 0) === 0
                ? undefined
                : writeDiffDetailsFile(report, manifest, new Date().toISOString());
        for (const line of formatDiffReport(report, manifest, detailsPath)) {
            ChatLib.chat(line);
        }
        progress.complete(
            `${report.clean} clean / ${report.conflicts.length} conflicts / ${report.unknown} unknown`
        );
    }).catch((error: unknown) => {
        if (isTaskCancelled(error)) {
            progress.clear();
            return;
        }
        const reason = errorReason(error);
        progress.fail(reason);
        diffFailure(reason);
    });
}
