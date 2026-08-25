import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
    type ImportablesParseResult,
} from "htsw";

import { openAnswerableConflictPrompt } from "../gui/popovers/conflictPrompt";
import type TaskContext from "../tasks/context";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { prunePlanPopoverLines, summarizeTargets } from "./report";
import type { PrunePlan, PruneTarget } from "./types";

export type PruneManifest = {
    path: string;
    parsed: ImportablesParseResult;
};

export type PruneManifestRefusal =
    | { reason: "missing"; path: string }
    | { reason: "unparseable"; message: string }
    | { reason: "errors"; count: number }
    | { reason: "notArmed" };

export type PruneManifestLoad =
    | { ok: true; manifest: PruneManifest }
    | { ok: false; refusal: PruneManifestRefusal };

/**
 * Loads a manifest and refuses every reason a prune must not run from it. The
 * parse-error gate matters most: a half-parsed manifest declares fewer
 * importables than the project has, and a prune reads "not declared" as "delete
 * it".
 */
export function loadPruneManifest(canonicalManifestPath: string): PruneManifestLoad {
    if (!FileLib.exists(canonicalManifestPath)) {
        return { ok: false, refusal: { reason: "missing", path: canonicalManifestPath } };
    }

    let parsed: ImportablesParseResult;
    try {
        parsed = parseImportablesResult(
            new SourceMap(new FileSystemFileLoader()),
            canonicalManifestPath
        );
    } catch (error) {
        return {
            ok: false,
            refusal: {
                reason: "unparseable",
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }

    const errorCount = countBlockingDiagnostics(parsed.diagnostics);
    if (errorCount > 0) {
        return { ok: false, refusal: { reason: "errors", count: errorCount } };
    }
    if (!parsed.importJson.dangerouslyDeleteEverythingNotInThisFile) {
        return { ok: false, refusal: { reason: "notArmed" } };
    }
    return { ok: true, manifest: { path: canonicalManifestPath, parsed } };
}

export function describePruneRefusal(refusal: PruneManifestRefusal): string {
    switch (refusal.reason) {
        case "missing":
            return `file doesn't exist '${refusal.path}'`;
        case "unparseable":
            return refusal.message;
        case "errors":
            return (
                `manifest has ${refusal.count} error${refusal.count === 1 ? "" : "s"}; ` +
                "a partial parse looks like it declares nothing"
            );
        case "notArmed":
            return "this manifest doesn't set `dangerouslyDeleteEverythingNotInThisFile`";
    }
}

function countBlockingDiagnostics(diagnostics: readonly Diagnostic[]): number {
    let count = 0;
    for (const diagnostic of diagnostics) {
        if (diagnostic.level === "error" || diagnostic.level === "bug") count++;
    }
    return count;
}

/**
 * The prompt shown before anything is removed. `firstTime` takes consent for a
 * project that has never pruned this house here, so its wording names what the
 * file is claiming rather than only what is about to go.
 */
export async function confirmPrune(
    ctx: TaskContext,
    targets: readonly PruneTarget[],
    plan: PrunePlan,
    manifestPath: string,
    firstTime: boolean
): Promise<boolean> {
    const summary = summarizeTargets(targets);
    const heading = firstTime
        ? `[htsw] ${manifestPath} claims this whole house. Removing ${summary}.`
        : `[htsw] Prune will remove ${summary}.`;
    return openAnswerableConflictPrompt(ctx, {
        chatMessage: `${heading}\n[htsw] Housing has no undo.`,
        chatConfirmAction: "remove them",
        chatRefuseAction: "leave the house alone",
        title: firstTime
            ? "Let this file delete everything else in this house?"
            : "Remove undeclared house content?",
        lines: prunePlanPopoverLines(targets, plan),
        confirmLabel: `Remove ${targets.length}`,
        cancelLabel: "Leave alone",
        danger: true,
    });
}
