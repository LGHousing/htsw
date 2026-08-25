import type { Event, Importable } from "htsw/types";
import type { ImportablesParseResult } from "htsw";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { deleteImportableCache, readImportableCache } from "../importCache/cache";
import { removeHouseLockImportables } from "../importCache/houseLock";
import { HOUSE_READERS } from "../importables/export/readers";
import { projectItemsFromParsedImportJson } from "../importables/export/projectDestination";
import { runImportSession } from "../importables/import/session";
import { pruneTypeOf } from "./registry";
import { describeTarget } from "./report";
import { writePruneRecord, type PruneRecordEntry } from "./record";
import type { PruneTarget } from "./types";

export type PruneApplyRequest = {
    manifestPath: string;
    housingUuid: string;
    parsed: ImportablesParseResult;
    /**
     * Reads each target's live content before removing it, so the record covers
     * things htsw had never read. Costs about what importing them costs.
     */
    rescue?: boolean;
    onProgress?: (done: number, total: number, target: PruneTarget) => void;
};

export type PruneApplyResult = {
    removed: PruneTarget[];
    failures: { target: PruneTarget; reason: string }[];
    /** Path of the record written before anything was removed. */
    recordPath: string | null;
    recordError: string | null;
};

/**
 * Removes every target in the plan. The record is written first, so a
 * disconnect halfway through still leaves a list of what was going. Failures
 * are collected rather than thrown, so one refused command does not abandon the
 * rest.
 */
export async function applyPrunePlan(
    ctx: TaskContext,
    targets: readonly PruneTarget[],
    request: PruneApplyRequest
): Promise<PruneApplyResult> {
    const result: PruneApplyResult = {
        removed: [],
        failures: [],
        recordPath: null,
        recordError: null,
    };
    if (targets.length === 0) return result;

    const entries: PruneRecordEntry[] = [];
    for (const target of targets) {
        ctx.checkCancelled();
        entries.push({
            type: target.type,
            identity: target.identity,
            method: target.method,
            previouslyImported: target.owned,
            content: await knownContent(ctx, target, request),
        });
    }

    try {
        result.recordPath = writePruneRecord(
            request.manifestPath,
            request.housingUuid,
            entries
        );
    } catch (error) {
        result.recordError = errorMessage(error);
    }

    const clearTargets = targets.filter((target) => target.method === "clearActions");
    const deleteTargets = targets.filter((target) => target.method === "delete");
    let done = 0;
    const total = targets.length;

    for (const target of deleteTargets) {
        ctx.checkCancelled();
        request.onProgress?.(done, total, target);
        const remove = pruneTypeOf(target.type).remove;
        if (remove === undefined) {
            result.failures.push({
                target,
                reason: `${target.type} has no removal path`,
            });
            done++;
            continue;
        }
        try {
            await remove(ctx, target.identity);
            result.removed.push(target);
        } catch (error) {
            if (isTaskCancelled(error)) throw error;
            result.failures.push({ target, reason: errorMessage(error) });
        }
        done++;
    }

    if (clearTargets.length > 0) {
        ctx.checkCancelled();
        request.onProgress?.(done, total, clearTargets[0]);
        await clearEventActions(ctx, clearTargets, request, result);
        done += clearTargets.length;
    }

    forgetRemoved(request, result.removed);
    return result;
}

/**
 * Undeclared events are emptied through a normal import of an empty action list,
 * so trust, progress and cache writes behave as they do for a declared event.
 */
async function clearEventActions(
    ctx: TaskContext,
    targets: readonly PruneTarget[],
    request: PruneApplyRequest,
    result: PruneApplyResult
): Promise<void> {
    const importables: Importable[] = targets.map((target) => ({
        type: "EVENT",
        event: target.identity as Event,
        actions: [],
    }));
    try {
        await runImportSession(ctx, {
            importables,
            trustMode: false,
            housingUuid: request.housingUuid,
            sourcePath: request.manifestPath,
            parsed: request.parsed,
            conflictHandling: { kind: "proceed" },
        });
        for (const target of targets) result.removed.push(target);
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        const reason = errorMessage(error);
        for (const target of targets) result.failures.push({ target, reason });
    }
}

/** Content for the record: free from the cache, or a full house read on rescue. */
async function knownContent(
    ctx: TaskContext,
    target: PruneTarget,
    request: PruneApplyRequest
): Promise<Importable | null> {
    const cached = readImportableCache(
        request.housingUuid,
        target.type,
        target.identity
    );
    if (cached !== null && cached.verified === true) return cached.importable;
    if (request.rescue !== true) return null;
    return readLiveContent(ctx, target, request);
}

async function readLiveContent(
    ctx: TaskContext,
    target: PruneTarget,
    request: PruneApplyRequest
): Promise<Importable | null> {
    // ITEM is the only type without a reader, and also the only unprunable one.
    const reader = HOUSE_READERS[target.type];
    let read: Importable | null = null;
    try {
        await reader(ctx, {
            importJsonPath: request.manifestPath,
            rootDir: "",
            projectItems: projectItemsFromParsedImportJson(request.parsed),
            names: [target.identity],
            quiet: true,
            output: {
                kind: "memory",
                housingUuid: request.housingUuid,
                accept: (importable) => {
                    read = importable;
                },
            },
        });
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        return null;
    }
    return read;
}

/**
 * Drops removed content from both baselines. Leaving it in the lock would make
 * the next save's vanish check propose removing the same things again.
 */
function forgetRemoved(
    request: PruneApplyRequest,
    removed: readonly PruneTarget[]
): void {
    if (removed.length === 0) return;
    for (const target of removed) {
        // A cleared event still exists; the import session rewrote it as empty.
        if (target.method === "clearActions") continue;
        deleteImportableCache(request.housingUuid, target.type, target.identity);
    }
    removeHouseLockImportables(
        request.manifestPath,
        removed.map((target) => ({ type: target.type, identity: target.identity }))
    );
}

export function formatPruneApplyResult(result: PruneApplyResult): string[] {
    const lines: string[] = [];
    if (result.recordPath !== null) {
        lines.push(`&7[htsw] Removal record: ${result.recordPath}`);
    } else if (result.recordError !== null) {
        lines.push(`&c[htsw] Couldn't write the prune record: ${result.recordError}`);
    }
    lines.push(
        `&a[htsw] Prune complete: ${result.removed.length} removed, ` +
            `${result.failures.length} failed.`
    );
    for (const failure of result.failures) {
        lines.push(`&c[htsw] Couldn't ${describeTarget(failure.target)}: ${failure.reason}`);
    }
    return lines;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
