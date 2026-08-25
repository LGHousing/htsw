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
import {
    prunePlanIsEmpty,
    unownedTargets,
    type PrunePlan,
    type PruneTarget,
} from "./types";

const PRUNE_COLOR = 0xffe85c5c;

/**
 * An armed, tracked project whose house we are standing in. Armed comes from the
 * parse rather than a setting, so removing the key from the file disarms it
 * immediately.
 */
type ArmedProject = {
    path: string;
    parsed: ImportablesParseResult;
};

function armedTrackedProjects(trackedSources: ReadonlySet<string>): ArmedProject[] {
    const uuid = getHousingUuid();
    if (uuid === null) return [];
    const projects: ArmedProject[] = [];
    forEachCachedParse((entry) => {
        if (!trackedSources.has(entry.canonicalPath)) return;
        const parsed = entry.parsed;
        if (parsed === null) return;
        if (!parsed.importJson.dangerouslyDeleteEverythingNotInThisFile) return;
        // A parse with hard errors declares less than the project really has.
        if (hasBlockingDiagnostics(parsed)) return;
        if (autoTrackBoundHouse(entry.canonicalPath) !== uuid) return;
        projects.push({ path: entry.canonicalPath, parsed });
    });
    return projects;
}

function hasBlockingDiagnostics(parsed: ImportablesParseResult): boolean {
    for (const diagnostic of parsed.diagnostics) {
        if (diagnostic.level === "error" || diagnostic.level === "bug") return true;
    }
    return false;
}

/**
 * Something undeclared is in the house that watch will not remove on its own.
 * Not a stored plan — the house may have moved on by the time anyone reviews it,
 * so reviewing re-scans.
 */
type PruneNotice = {
    manifestPath: string;
    unownedCount: number;
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

function raiseNotice(manifestPath: string, targets: readonly PruneTarget[]): void {
    if (targets.length === 0) return;
    notice = { manifestPath, unownedCount: targets.length };
    showToast(
        `${summarizeTargets(targets)} aren't in your file, and htsw didn't make ` +
            "them — /htsw prune to review",
        PRUNE_COLOR,
        10000,
        "prune-review"
    );
    ChatLib.chat(
        `&c[htsw] ${summarizeTargets(targets)} aren't declared by ${manifestPath}, ` +
            "and htsw has no record of making them."
    );
    ChatLib.chat(
        `&7[htsw] Nothing was removed. Run &f/htsw prune ${manifestPath} --apply&7 to review.`
    );
}

/**
 * The fast path: what a save alone can prove is gone, with no Housing round trip.
 * Reparse-only — the steady-state cache-warm tick would otherwise re-read
 * house.lock every few seconds for nothing.
 */
export function watchPruneOnReparse(trackedSources: ReadonlySet<string>): void {
    if (pruneRunning || TaskManager.isBusy()) return;
    for (const project of armedTrackedProjects(trackedSources)) {
        const work = vanishedWork(project.parsed.value, project.path);
        if (work.renames.length === 0 && work.plan.targets.length === 0) continue;
        runPrune(project, work.plan, work.renames, "vanished");
        return;
    }
}

/**
 * The slow path, run once when watch is armed. The only place unowned content
 * surfaces, since the lock knows nothing htsw did not create.
 */
export function watchPruneSweep(trackedSources: ReadonlySet<string>): void {
    if (pruneRunning || TaskManager.isBusy()) return;
    const projects = armedTrackedProjects(trackedSources);
    if (projects.length === 0) return;
    const project = projects[0];

    pruneRunning = true;
    void runHousingSyncTask("prune", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const plan = await scanHousePrunePlan(ctx, {
            declared: project.parsed.value,
            housingUuid,
            importJsonPath: project.path,
        });
        if (prunePlanIsEmpty(plan)) return;
        for (const line of formatPrunePlan(plan, project.path)) ChatLib.chat(line);

        const unowned = unownedTargets(plan);
        const owned = plan.targets.filter((target) => target.owned);
        if (unowned.length > 0) raiseNotice(project.path, unowned);
        if (owned.length === 0) return;
        await prune(ctx, project, plan, owned, housingUuid, "sweep");
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
 * Removes targets, asking once per project and house before the first time. The
 * targets are all htsw's own work, but the key authorising their removal can
 * arrive from a clone, so the first removal is still confirmed.
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
    if (!hasPruneConsent(project.path, housingUuid)) {
        if (!(await confirmPrune(ctx, targets, plan, project.path, true))) {
            ChatLib.chat("&7[htsw] Prune declined — nothing was removed.");
            return;
        }
        grantPruneConsent(project.path, housingUuid);
    }

    showToast(
        `Watch: removing ${summarizeTargets(targets)} no longer in your file`,
        PRUNE_COLOR,
        6000
    );
    const result = await applyPrunePlan(ctx, targets, {
        manifestPath: project.path,
        housingUuid,
        parsed: project.parsed,
    });
    for (const line of formatPruneApplyResult(result)) ChatLib.chat(line);
    if (origin === "vanished" && result.failures.length === 0) {
        showToast(`Watch: removed ${summarizeTargets(result.removed)}`, PRUNE_COLOR, 4000);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
