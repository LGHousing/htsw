import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";

import { canonicalPath } from "../gui/parsing/parses";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { resolveModuleRelativePath } from "../project/paths";
import { TaskManager } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { stripSurroundingQuotes } from "../utils/helpers";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import { scanHousePrunePlan } from "../prune/plan";
import { formatPrunePlan } from "../prune/report";

function pruneFailure(reason: string): void {
    ChatLib.chat(`&c[htsw] Prune failed: ${reason}`);
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

export type PruneManifest = {
    path: string;
    parsed: ImportablesParseResult;
};

/**
 * Loads a manifest and refuses every reason a prune must not run from it.
 *
 * The parse-error gate is the important one. A manifest that only half-parsed
 * declares fewer importables than the project actually has, and a prune reads
 * "not declared" as "delete it" — so a single typo would propose wiping the
 * work the typo was in the middle of.
 */
export function loadPruneManifest(rawPath: string): PruneManifest | null {
    const path = canonicalPath(resolveModuleRelativePath(stripSurroundingQuotes(rawPath)));
    if (!FileLib.exists(path)) {
        pruneFailure(`file does not exist '${path}'`);
        return null;
    }

    let parsed: ImportablesParseResult;
    try {
        parsed = parseImportablesResult(new SourceMap(new FileSystemFileLoader()), path);
    } catch (error) {
        pruneFailure(errorReason(error));
        return null;
    }

    const errorCount = countBlockingDiagnostics(parsed.diagnostics);
    if (errorCount > 0) {
        pruneFailure(
            `manifest has ${errorCount} error${errorCount === 1 ? "" : "s"} — ` +
                "a partly-parsed manifest would look like it declares nothing"
        );
        return null;
    }

    if (!parsed.importJson.dangerouslyDeleteEverythingNotInThisFile) {
        pruneFailure(
            "this manifest does not set `dangerouslyDeleteEverythingNotInThisFile`"
        );
        ChatLib.chat(
            "&7[htsw] Add it next to `houseUuid` to declare this file is the whole house."
        );
        return null;
    }

    return { path, parsed };
}

export function commandPrune(args: string[]): void {
    const pathArgs = args.filter((arg) => !arg.startsWith("--"));
    if (pathArgs.length === 0) {
        pruneFailure("expected a manifest path");
        ChatLib.chat("&7[htsw] Usage: /htsw prune <import.json>");
        return;
    }
    if (TaskManager.isBusy()) {
        pruneFailure("another task is already running");
        return;
    }

    const manifest = loadPruneManifest(pathArgs.join(" "));
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
    }).catch((error: unknown) => {
        pruneFailure(errorReason(error));
    });
}
