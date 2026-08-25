import { canonicalPath } from "../gui/parsing/parses";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { resolveModuleRelativePath } from "../project/paths";
import { TaskManager } from "../tasks/manager";
import { stripSurroundingQuotes } from "../utils/helpers";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import { applyPrunePlan, formatPruneApplyResult } from "../prune/apply";
import {
    grantPruneConsent,
    hasPruneConsent,
    revokePruneConsent,
} from "../prune/consent";
import { scanHousePrunePlan } from "../prune/plan";
import { formatPrunePlan } from "../prune/report";
import {
    confirmPrune,
    describePruneRefusal,
    loadPruneManifest,
    type PruneManifest,
} from "../prune/session";
import { prunePlanIsEmpty } from "../prune/types";

function pruneFailure(reason: string): void {
    ChatLib.chat(`&c[htsw] Prune failed: ${reason}`);
}

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function resolveManifest(rawPath: string): PruneManifest | null {
    const path = canonicalPath(resolveModuleRelativePath(stripSurroundingQuotes(rawPath)));
    const load = loadPruneManifest(path);
    if (load.ok) return load.manifest;
    pruneFailure(describePruneRefusal(load.refusal));
    if (load.refusal.reason === "notArmed") {
        ChatLib.chat(
            "&7[htsw] Add it next to `houseUuid` to declare this file is the whole house."
        );
    }
    return null;
}

export function commandPrune(args: string[]): void {
    const apply = args.indexOf("--apply") >= 0;
    const rescue = args.indexOf("--rescue") >= 0;
    const forget = args.indexOf("--forget-consent") >= 0;
    const pathArgs = args.filter((arg) => !arg.startsWith("--"));
    if (pathArgs.length === 0) {
        pruneFailure("expected a manifest path");
        ChatLib.chat(
            "&7[htsw] Usage: /htsw prune <import.json> [--apply] [--rescue] " +
                "[--forget-consent]"
        );
        return;
    }
    if (TaskManager.isBusy()) {
        pruneFailure("another task is already running");
        return;
    }

    const manifest = resolveManifest(pathArgs.join(" "));
    if (manifest === null) return;

    void runHousingSyncTask("prune", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const bound = manifest.parsed.importJson.houseUuid;
        if (bound !== null && bound !== housingUuid) {
            pruneFailure(
                "this manifest is bound to a different house than the one you are in"
            );
            return;
        }

        if (forget) {
            revokePruneConsent(manifest.path, housingUuid);
            ChatLib.chat(
                "&7[htsw] Forgot this project's prune confirmation."
            );
            return;
        }

        ChatLib.chat("&7[htsw] Scanning this house…");
        const plan = await scanHousePrunePlan(ctx, {
            declared: manifest.parsed.value,
            housingUuid,
            importJsonPath: manifest.path,
            onTypeScanned: (type, found, undeclared) => {
                ChatLib.chat(
                    `&8[htsw]   ${type.toLowerCase()}: ${found} in house, ${undeclared} undeclared`
                );
            },
        });

        for (const line of formatPrunePlan(plan, manifest.path)) {
            ChatLib.chat(line);
        }

        if (!apply) {
            if (!prunePlanIsEmpty(plan)) {
                ChatLib.chat(
                    "&7[htsw] This was a dry run. Re-run with &f--apply&7 to remove them."
                );
            }
            return;
        }
        if (plan.targets.length === 0) return;

        // An incomplete scan can only under-delete, but reporting the house as
        // matching the file afterwards would be wrong. Re-run instead.
        if (plan.scanFailures.length > 0) {
            pruneFailure(
                "couldn't scan part of the house; fix that and re-run"
            );
            return;
        }

        const firstTime = !hasPruneConsent(manifest.path, housingUuid);
        if (!(await confirmPrune(ctx, plan.targets, plan, manifest.path, firstTime))) {
            ChatLib.chat("&7[htsw] Prune cancelled — nothing was removed.");
            return;
        }
        if (firstTime && !grantPruneConsent(manifest.path, housingUuid)) {
            ChatLib.chat(
                "&c[htsw] Couldn't save your confirmation; it'll ask again."
            );
        }

        const result = await applyPrunePlan(ctx, plan.targets, {
            manifestPath: manifest.path,
            housingUuid,
            parsed: manifest.parsed,
            rescue,
            onProgress: (done, total, target) => {
                ChatLib.chat(`&8[htsw]   [${done + 1}/${total}] ${target.identity}`);
            },
        });
        for (const line of formatPruneApplyResult(result)) ChatLib.chat(line);
    }).catch((error: unknown) => {
        pruneFailure(errorReason(error));
    });
}
