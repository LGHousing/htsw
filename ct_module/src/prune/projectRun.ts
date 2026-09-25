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
    const { renames } = vanishedWork(project.parsed.value, project.path);
    if (renames.length === 0) return;
    const outcome = await applyRenames(ctx, project.path, renames);
    for (const rename of outcome.renamed) {
        ChatLib.chat(
            `&7[htsw] Renamed ${rename.type.toLowerCase()} ${rename.from} to ` +
                `${rename.to} instead of recreating it.`
        );
    }
}

/**
 * After a project imported everything: removes what the file does not declare.
 * `fullScan` walks the whole house, the only way to find content htsw never
 * made; otherwise only what house.lock says a save stopped declaring goes.
 */
export async function finishProjectRun(
    ctx: TaskContext,
    row: QueueRow,
    house: string,
    fullScan: boolean
): Promise<void> {
    const project = await readArmedProject(row);
    if (project === null) return;
    const refusal = pruneRefusal(project, house);
    if (refusal !== null) throw new Error(refusal);

    if (fullScan) {
        ChatLib.chat(`&7[htsw] Checking the house for anything ${project.path} doesn't declare…`);
    }
    const plan = fullScan
        ? await scanHousePrunePlan(ctx, {
              declared: project.parsed.value,
              housingUuid: house,
              importJsonPath: project.path,
          })
        : vanishedWork(project.parsed.value, project.path).plan;

    if (plan.targets.length > 0) {
        for (const line of formatPrunePlan(plan, project.path)) ChatLib.chat(line);
        if (!hasPruneConsent(project.path, house)) {
            const confirmed = await confirmPrune(
                ctx,
                plan.targets,
                plan,
                project.path,
                true
            );
            if (!confirmed) throw new Error("removal declined; nothing was removed");
            if (!grantPruneConsent(project.path, house)) {
                ChatLib.chat("&c[htsw] Couldn't save your confirmation; it'll ask again.");
            }
        }
        // Rescue reads anything htsw holds no verified copy of into the removal
        // record first, so content it never made can still be rebuilt.
        const result = await applyPrunePlan(ctx, plan.targets, {
            manifestPath: project.path,
            housingUuid: house,
            parsed: project.parsed,
            rescue: true,
        });
        for (const line of formatPruneApplyResult(result)) ChatLib.chat(line);
        if (result.failures.length > 0) {
            const count = result.failures.length;
            throw new Error(`${count} undeclared thing${count === 1 ? "" : "s"} couldn't be removed`);
        }
    }

    // What did scan was still acted on; the row fails because the house is not
    // known to match the file.
    if (plan.scanFailures.length > 0) {
        const types = plan.scanFailures.map((failure) => failure.type.toLowerCase());
        throw new Error(`couldn't scan ${types.join(", ")}; the house may hold more undeclared content`);
    }
}
