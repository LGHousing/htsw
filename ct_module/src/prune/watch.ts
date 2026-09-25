import type { ImportablesParseResult } from "htsw";

import { autoTrackBoundHouse } from "../gui/autoTrackScope";
import { forEachCachedParse } from "../gui/parsing/parses";
import { getHousingUuid } from "../gui/state/housing";
import { showToast } from "../gui/toast";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import { TaskManager } from "../tasks/manager";
import { applyPrunePlan, formatPruneApplyResult } from "./apply";
import { grantPruneConsent, hasPruneConsent } from "./consent";
import { scanHousePrunePlan, vanishedWork } from "./plan";
import { applyRenames, type PruneRename } from "./rename";
import { formatPrunePlan, summarizeTargets } from "./report";
import { confirmPrune } from "./session";
import type { PrunePlan, PruneTarget } from "./types";

const PRUNE_COLOR = 0xffe85c5c;

/**
 * An armed, tracked project. Armed comes from the parse rather than a setting,
 * so removing the key from the file disarms it immediately.
 */
type ArmedProject = {
    path: string;
    parsed: ImportablesParseResult;
    /** The house the project is bound to; armed manifests always have one. */
    houseUuid: string | null;
};

function armedTrackedProjects(trackedSources: ReadonlySet<string>): ArmedProject[] {
    const projects: ArmedProject[] = [];
    forEachCachedParse((entry) => {
        if (!trackedSources.has(entry.canonicalPath)) return;
        const parsed = entry.parsed;
        if (parsed === null) return;
        if (!parsed.importJson.dangerouslyDeleteEverythingNotInThisFile) return;
        // A parse with hard errors declares less than the project really has.
        if (hasBlockingDiagnostics(parsed)) return;
        projects.push({
            path: entry.canonicalPath,
            parsed,
            houseUuid: autoTrackBoundHouse(entry.canonicalPath),
        });
    });
    return projects;
}

/** Armed projects bound to the house we are standing in. */
function armedProjectsHere(trackedSources: ReadonlySet<string>): ArmedProject[] {
    const uuid = getHousingUuid();
    if (uuid === null) return [];
    return armedTrackedProjects(trackedSources).filter(
        (project) => project.houseUuid === uuid
    );
}

function hasBlockingDiagnostics(parsed: ImportablesParseResult): boolean {
    for (const diagnostic of parsed.diagnostics) {
        if (diagnostic.level === "error" || diagnostic.level === "bug") return true;
    }
    return false;
}

/**
 * The house was left not matching the file, and watch will not retry on its
 * own: a declined confirmation, a removal Housing refused, or a scan that could
 * not finish. Not a stored plan — the house may have moved on by the time anyone
 * reviews it, so reviewing re-scans.
 */
type PruneNotice = {
    manifestPath: string;
    /** Short badge text, e.g. "3 undeclared left". */
    text: string;
};

let notice: PruneNotice | null = null;
let pruneRunning = false;

export function getPruneNotice(): PruneNotice | null {
    return notice;
}

export function isWatchPruneRunning(): boolean {
    return pruneRunning;
}

export function clearPruneNotice(): void {
    notice = null;
}

function raiseNotice(manifestPath: string, text: string): void {
    notice = { manifestPath, text };
    showToast(`${text} — /htsw prune to review`, PRUNE_COLOR, 10000, "prune-review");
    ChatLib.chat(
        `&7[htsw] Run &f/htsw prune ${manifestPath} --apply&7 to finish by hand.`
    );
}

/**
 * The fast path: what a save alone can prove is gone, with no Housing round trip.
 * Reparse-only — the steady-state cache-warm tick would otherwise re-read
 * house.lock every few seconds for nothing.
 */
export function watchPruneOnReparse(trackedSources: ReadonlySet<string>): void {
    if (pruneRunning || TaskManager.isBusy()) return;
    for (const project of armedProjectsHere(trackedSources)) {
        const work = vanishedWork(project.parsed.value, project.path);
        if (work.renames.length === 0 && work.plan.targets.length === 0) continue;
        runPrune(project, work.plan, work.renames, "vanished");
        return;
    }
}

/**
 * The slow path, run once when watch is armed. The only place content htsw did
 * not create surfaces, since the lock knows nothing about it — so it is also the
 * only place the file's claim to the whole house is actually enforced.
 */
export function watchPruneSweep(trackedSources: ReadonlySet<string>): void {
    if (pruneRunning || TaskManager.isBusy()) return;
    const armed = armedTrackedProjects(trackedSources);
    if (armed.length === 0) return;
    const uuid = getHousingUuid();
    const project = armed.find((candidate) => candidate.houseUuid === uuid) ?? null;
    if (project === null) {
        // The sweep runs once per arm and does not wait for a house, so say so
        // now rather than let the file's claim look enforced.
        const path = armed[0].path;
        ChatLib.chat(
            `&e[htsw] ${path} claims its whole house, but you aren't in it, so ` +
                "nothing was swept."
        );
        ChatLib.chat(
            `&7[htsw] Arm watch from inside the house, or run ` +
                `&f/htsw prune ${path} --apply&7 there.`
        );
        return;
    }

    pruneRunning = true;
    void runHousingSyncTask("prune", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const plan = await scanHousePrunePlan(ctx, {
            declared: project.parsed.value,
            housingUuid,
            importJsonPath: project.path,
        });
        if (plan.targets.length > 0) {
            for (const line of formatPrunePlan(plan, project.path)) ChatLib.chat(line);
            await prune(ctx, project, plan, plan.targets, housingUuid, "sweep");
        }
        // A partial scan only under-removes, so what did scan still goes; the
        // badge stays up because the house is not known to match the file.
        if (plan.scanFailures.length > 0) {
            raiseNotice(project.path, "sweep incomplete");
        }
    })
        .catch((error: unknown) => {
            ChatLib.chat(`&c[htsw] Prune sweep failed: ${errorMessage(error)}`);
        })
        .then(() => {
            pruneRunning = false;
        });
}

function runPrune(
    project: ArmedProject,
    plan: PrunePlan,
    renames: readonly PruneRename[],
    origin: "vanished" | "sweep"
): void {
    pruneRunning = true;
    void runHousingSyncTask("prune", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        // Renames first: they carry the baseline to the new name, so the import
        // that follows diffs instead of rewriting.
        const unconfirmed = await runRenames(ctx, project, renames);
        // An unconfirmed rename leaves the old name in place, so it goes back
        // to being ordinary undeclared content.
        const targets = plan.targets.concat(
            unconfirmed.map((rename) => ({
                type: rename.type,
                identity: rename.from,
                label: rename.from,
                method: "delete" as const,
                owned: true,
            }))
        );
        await prune(ctx, project, plan, targets, housingUuid, origin);
    })
        .catch((error: unknown) => {
            ChatLib.chat(`&c[htsw] Prune failed: ${errorMessage(error)}`);
        })
        .then(() => {
            pruneRunning = false;
            // The queue was built before the renames landed.
            onPruneFinished?.();
        });
}

async function runRenames(
    ctx: Parameters<typeof applyPrunePlan>[0],
    project: ArmedProject,
    renames: readonly PruneRename[]
): Promise<PruneRename[]> {
    if (renames.length === 0) return [];
    const outcome = await applyRenames(ctx, project.path, renames);
    for (const rename of outcome.renamed) {
        ChatLib.chat(
            `&7[htsw] Renamed ${rename.type.toLowerCase()} ${rename.from} to ` +
                `${rename.to} instead of recreating it.`
        );
    }
    return outcome.unconfirmed;
}

/**
 * Called after a prune task ends so auto-track can rebuild the queue against the
 * moved baselines. Injected rather than imported, to avoid a cycle.
 */
let onPruneFinished: (() => void) | null = null;

export function setOnPruneFinished(callback: () => void): void {
    onPruneFinished = callback;
}

/**
 * Removes targets. htsw's own work goes unasked after the project's first
 * confirmation — the key authorising it can arrive from a clone, so even that
 * is confirmed once. Content the lock has no record of is confirmed every time:
 * it is someone's work htsw has never read, and a sweep is the only place it
 * surfaces, so the prompt is rare.
 */
async function prune(
    ctx: Parameters<typeof applyPrunePlan>[0],
    project: ArmedProject,
    plan: PrunePlan,
    targets: readonly PruneTarget[],
    housingUuid: string,
    origin: "vanished" | "sweep"
): Promise<void> {
    if (targets.length === 0) return;
    notice = null;
    const firstTime = !hasPruneConsent(project.path, housingUuid);
    const unowned = targets.some((target) => !target.owned);
    if (firstTime || unowned) {
        if (!(await confirmPrune(ctx, targets, plan, project.path, firstTime))) {
            ChatLib.chat("&7[htsw] Prune declined — nothing was removed.");
            raiseNotice(project.path, `${targets.length} undeclared left`);
            return;
        }
        if (firstTime) grantPruneConsent(project.path, housingUuid);
    }

    showToast(
        `Watch: removing ${summarizeTargets(targets)} not in your file`,
        PRUNE_COLOR,
        6000
    );
    const result = await applyPrunePlan(ctx, targets, {
        manifestPath: project.path,
        housingUuid,
        parsed: project.parsed,
    });
    for (const line of formatPruneApplyResult(result)) ChatLib.chat(line);
    if (result.failures.length > 0) {
        raiseNotice(project.path, `${result.failures.length} not removed`);
        return;
    }
    if (origin === "vanished") {
        showToast(`Watch: removed ${summarizeTargets(result.removed)}`, PRUNE_COLOR, 4000);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
