import type { Diagnostic, ImportablesParseResult } from "htsw";

import { autoTrackBoundHouse } from "../gui/autoTrackScope";
import { parseImportJsonCurrent } from "../gui/parsing/parses";
import { getAutoTrackSources } from "../gui/state/autoTrack";
import type { QueueRow } from "../gui/right-panel/import-tab/queue";
import type TaskContext from "../tasks/context";
import { applyPrunePlan, formatPruneApplyResult } from "./apply";
import { grantPruneConsent, hasPruneConsent } from "./consent";
import { scanHousePrunePlan, vanishedWork } from "./plan";
import { applyRenames } from "./rename";
import { formatPrunePlan } from "./report";
import { confirmPrune } from "./session";
import { pruneTypeOf } from "./registry";
import { setTaskActivity } from "../tasks/activity";
import { shortPath } from "../gui/lib/pathDisplay";

/**
 * A project that sets `dangerouslyDeleteEverythingNotInThisFile`, parsed as it
 * is on disk now rather than as it was when it was queued.
 */
type ArmedProject = { path: string; parsed: ImportablesParseResult };

async function readArmedProject(row: QueueRow): Promise<ArmedProject | null> {
    const parsed = (await parseImportJsonCurrent(row.path)).parsed;
    if (parsed === null || !parsed.importJson.dangerouslyDeleteEverythingNotInThisFile) {
        return null;
    }
    return { path: row.path, parsed };
}

/**
 * Every reason an armed project must not remove anything from this house, or
 * null when it may. The error gate matters most: a half-parsed manifest declares
 * fewer importables than the project has, and "not declared" reads as "delete it".
 */
function pruneRefusal(project: ArmedProject, house: string): string | null {
    const errors = countBlockingDiagnostics(project.parsed.diagnostics);
    if (errors > 0) {
        return (
            `nothing removed: the project has ${errors} error${errors === 1 ? "" : "s"}, ` +
            "and a partial parse looks like it declares less than it does"
        );
    }
    if (project.parsed.importJson.houseUuid !== house) {
        return "nothing removed: the project is bound to a different house";
    }
    const others = otherTrackedProjectsOn(house, project.path);
    if (others.length > 0) {
        return (
            `nothing removed: ${others[0]} is also tracked for this house. ` +
            "One import.json has to claim the whole house; include the other from it."
        );
    }
    return null;
}

function otherTrackedProjectsOn(house: string, path: string): string[] {
    const others: string[] = [];
    getAutoTrackSources().forEach((source) => {
        if (source !== path && autoTrackBoundHouse(source) === house) others.push(source);
    });
    return others;
}

/**
 * Whether auto-track should queue this project for removal work alone: it
 * sets the key and parses cleanly. The finishing step re-checks the rest.
 */
export function isArmedForPrune(parsed: ImportablesParseResult): boolean {
    return (
        parsed.importJson.dangerouslyDeleteEverythingNotInThisFile &&
        countBlockingDiagnostics(parsed.diagnostics) === 0
    );
}

// Projects whose house was walked in full since auto-run was switched on. A
// project missing here gets one full scan on its next auto-tracked run.
const scannedSinceArming = new Set<string>();
// Bumped whenever this module changes house.lock, which is what the memoised
// removal check below reads.
let lockRevision = 0;
const removalMemo = new WeakMap<
    ImportablesParseResult,
    { path: string; revision: number; pending: boolean }
>();

let onArmingScansReset: (() => void) | null = null;

/**
 * Called after the scans are reset, so auto-track can queue the projects that
 * now owe one. Injected rather than imported, to avoid a cycle.
 */
export function setOnArmingScansReset(callback: () => void): void {
    onArmingScansReset = callback;
}

/** Auto-run was switched on: every armed project gets one full scan again. */
export function resetArmingScans(): void {
    scannedSinceArming.clear();
    onArmingScansReset?.();
}

export function needsArmingScan(path: string): boolean {
    return !scannedSinceArming.has(path);
}

/**
 * Whether house.lock records something this parse no longer declares.
 * Memoised per parse, because auto-track asks on every cache-warm tick and the
 * answer only changes with a reparse or a lock this module rewrote.
 */
export function hasPendingRemovals(
    path: string,
    parsed: ImportablesParseResult
): boolean {
    const memo = removalMemo.get(parsed);
    if (memo !== undefined && memo.path === path && memo.revision === lockRevision) {
        return memo.pending;
    }
    const work = vanishedWork(parsed.value, path);
    const pending = work.plan.targets.length > 0 || work.renames.length > 0;
    removalMemo.set(parsed, { path, revision: lockRevision, pending });
    return pending;
}

function countBlockingDiagnostics(diagnostics: readonly Diagnostic[]): number {
    let count = 0;
    for (const diagnostic of diagnostics) {
        if (diagnostic.level === "error" || diagnostic.level === "bug") count++;
    }
    return count;
}

/**
 * Before a project imports: renames a save made, so the import that follows
 * diffs the renamed object instead of creating it from scratch. A rename Housing
 * does not confirm leaves the old name behind for the finishing step to remove.
 */
export async function beginProjectRun(
    ctx: TaskContext,
    row: QueueRow,
    house: string
): Promise<void> {
    const project = await readArmedProject(row);
    // Renames also act on the file's claim to the house, so they wait for the
    // same conditions; the finishing step reports the refusal.
    if (project === null || pruneRefusal(project, house) !== null) return;
    setTaskActivity(`Checking ${shortPath(project.path)} for renames`);
    const { renames } = vanishedWork(project.parsed.value, project.path);
    if (renames.length === 0) return;
    setTaskActivity(
        renames.length === 1
            ? `Renaming ${renames[0].type.toLowerCase()} ${renames[0].from} to ${renames[0].to}`
            : `Renaming ${renames.length} things a save renamed`
    );
    const outcome = await applyRenames(ctx, project.path, renames);
    lockRevision++;
    for (const rename of outcome.renamed) {
        ChatLib.chat(
            `&7[htsw] Renamed ${rename.type.toLowerCase()} ${rename.from} to ` +
                `${rename.to} instead of recreating it.`
        );
    }
}

/**
 * After a project imported everything: removes what the file does not declare.
 * A row you queued walks the whole house, the only way to find content htsw
 * never made. A row auto-track queued does that once per auto-run session and
 * otherwise only removes what house.lock says a save stopped declaring.
 */
export async function finishProjectRun(
    ctx: TaskContext,
    row: QueueRow,
    house: string
): Promise<void> {
    const project = await readArmedProject(row);
    if (project === null) return;
    const refusal = pruneRefusal(project, house);
    if (refusal !== null) throw new Error(refusal);

    const fullScan = row.origin !== "autotrack" || needsArmingScan(project.path);

    if (fullScan) {
        ChatLib.chat(
            `&7[htsw] Checking the house for anything ${project.path} doesn't declare…`
        );
    } else {
        setTaskActivity("Checking what a save removed");
    }
    const plan = fullScan
        ? await scanHousePrunePlan(ctx, {
              declared: project.parsed.value,
              housingUuid: house,
              importJsonPath: project.path,
              onTypeStarted: (type) => {
                  setTaskActivity(
                      `Looking for undeclared ${pruneTypeOf(type).pluralLabel} in the house`
                  );
              },
          })
        : vanishedWork(project.parsed.value, project.path).plan;

    if (plan.targets.length > 0) {
        for (const line of formatPrunePlan(plan, project.path)) ChatLib.chat(line);
        if (!hasPruneConsent(project.path, house)) {
            setTaskActivity("Waiting for you to confirm the removal");
            const confirmed = await confirmPrune(
                ctx,
                plan.targets,
                plan,
                project.path,
                true
            );
            if (!confirmed) throw new Error("removal declined; nothing was removed");
            if (!grantPruneConsent(project.path, house)) {
                ChatLib.chat(
                    "&c[htsw] Couldn't save your confirmation; it'll ask again."
                );
            }
        }
        // Rescue reads anything htsw holds no verified copy of into the removal
        // record first, so content it never made can still be rebuilt.
        setTaskActivity("Saving undeclared content to the removal record");
        const result = await applyPrunePlan(ctx, plan.targets, {
            manifestPath: project.path,
            housingUuid: house,
            parsed: project.parsed,
            rescue: true,
            onProgress: (done, total, target) => {
                setTaskActivity(`Removing ${done + 1}/${total}: ${target.label}`);
            },
        });
        lockRevision++;
        for (const line of formatPruneApplyResult(result)) ChatLib.chat(line);
        if (result.failures.length > 0) {
            const count = result.failures.length;
            throw new Error(
                `${count} undeclared thing${count === 1 ? "" : "s"} couldn't be removed`
            );
        }
    }

    // What did scan was still acted on; the row fails because the house is not
    // known to match the file.
    if (plan.scanFailures.length > 0) {
        const types = plan.scanFailures.map((failure) => failure.type.toLowerCase());
        throw new Error(
            `couldn't scan ${types.join(", ")}; the house may hold more undeclared content`
        );
    }
    if (fullScan) scannedSinceArming.add(project.path);
}
