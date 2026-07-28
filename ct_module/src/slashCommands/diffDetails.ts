import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";

import type { ActionListConflictDifference } from "../housingSync/actions/conflictDetails";
import { parentDirOf } from "../project/paths";
import { atomicWriteText } from "../utils/filesystem";
import { unifiedDiff } from "./unifiedDiff";

export type DiffPrinterDiagnostic = {
    side: "source" | "live";
    level: "warning";
    message: string;
};

type DiffDetailsConflict = {
    type: Importable["type"];
    identity: string;
    basePath: string;
    canonicalDifferences: readonly ActionListConflictDifference[];
    printerDiagnostics: readonly DiffPrinterDiagnostic[];
    revertsTo?: string;
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    pendingChanges?: readonly DiffDetailsConflict[];
    unknown: number;
};

function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
}

export function printerDiagnosticsForDiff(
    side: DiffPrinterDiagnostic["side"],
    actions: readonly Action[]
): DiffPrinterDiagnostic[] {
    return htsw.htsl.printActionsWithDiagnostics(actions).diagnostics.map(
        (diagnostic) => ({
            side,
            level: diagnostic.level,
            message: diagnostic.message,
        })
    );
}

function diffDetailsPath(manifest: string): string {
    return `${parentDirOf(manifest)}/htsw-diff/latest.diff`;
}

export function formatDiffDetailsFile(
    report: DiffDetailsReport,
    manifest: string,
    timestamp: string
): string {
    const lines = [
        "# HTSW diff details",
        `# timestamp: ${timestamp}`,
        `# manifest: ${manifest}`,
        `# clean: ${report.clean}`,
        `# conflicts: ${report.conflicts.length}`,
        `# unknown: ${report.unknown}`,
        "# Values use the canonical field comparison that determined the verdict.",
    ];
    appendListDiffs(lines, report.conflicts, false);
    if ((report.pendingChanges?.length ?? 0) > 0) {
        lines.push("", "# PENDING CHANGES (what this import will write)");
        appendListDiffs(lines, report.pendingChanges ?? [], true);
    }
    return lines.join("\n") + "\n";
}

function appendListDiffs(
    lines: string[],
    lists: readonly DiffDetailsConflict[],
    liveToSource: boolean
): void {
    for (const conflict of lists) {
        const beforeSide = liveToSource ? "live" : "source";
        const afterSide = liveToSource ? "source" : "live";
        const beforeText = canonicalDifferenceText(
            conflict.canonicalDifferences,
            beforeSide
        );
        const afterText = canonicalDifferenceText(
            conflict.canonicalDifferences,
            afterSide
        );
        const beforeLabel = liveToSource ? "live" : "source";
        const afterLabel = liveToSource ? "source" : "live";
        const diff = unifiedDiff(
            beforeText,
            afterText,
            `${beforeLabel}/${conflict.basePath}`,
            `${afterLabel}/${conflict.basePath}`
        );
        lines.push(
            "",
            `# ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`
        );
        if (conflict.revertsTo !== undefined) {
            lines.push(`# ⚠ reverts to recorded state from ${conflict.revertsTo}`);
        }
        for (const diagnostic of conflict.printerDiagnostics) {
            lines.push(
                `# HTSL printer ${diagnostic.level} (${diagnostic.side}): ${diagnostic.message}`
            );
        }
        lines.push(
            diff === ""
                ? "# Conflict verdict had no renderable canonical field difference."
                : withoutFinalNewline(diff)
        );
    }
}

function canonicalDifferenceText(
    differences: readonly ActionListConflictDifference[],
    side: "source" | "live"
): string {
    const lines: string[] = [];
    for (const difference of differences) {
        lines.push(difference.path, `  ${difference[side]}`);
    }
    return lines.join("\n") + (lines.length === 0 ? "" : "\n");
}

export function writeDiffDetailsFile(
    report: DiffDetailsReport,
    manifest: string,
    timestamp: string
): string {
    const path = diffDetailsPath(manifest);
    if (!atomicWriteText(path, formatDiffDetailsFile(report, manifest, timestamp))) {
        throw new Error(`could not write diff details '${path}'`);
    }
    return path;
}
