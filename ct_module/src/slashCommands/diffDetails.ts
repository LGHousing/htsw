import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";

import type { ActionListConflictDifference } from "../housingSync/actions/conflictDetails";
import { parentDirOf } from "../project/paths";
import { atomicWriteText } from "../utils/filesystem";

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
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    unknown: number;
};

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
    for (const conflict of report.conflicts) {
        lines.push("", `# ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`);
        for (const diagnostic of conflict.printerDiagnostics) {
            lines.push(
                `# HTSL printer ${diagnostic.level} (${diagnostic.side}): ${diagnostic.message}`
            );
        }
        if (conflict.canonicalDifferences.length === 0) {
            lines.push(
                "# Conflict verdict had no renderable canonical field difference."
            );
            continue;
        }
        lines.push(
            `--- source/${conflict.basePath}`,
            `+++ live/${conflict.basePath}`
        );
        for (const difference of conflict.canonicalDifferences) {
            lines.push(
                ` ${difference.path}`,
                `-  ${difference.source}`,
                `+  ${difference.live}`
            );
        }
    }
    return lines.join("\n") + "\n";
}

export function writeDiffDetailsFile(
    report: DiffDetailsReport,
    manifest: string,
    timestamp: string
): string {
    const path = diffDetailsPath(manifest);
    if (!atomicWriteText(path, formatDiffDetailsFile(report, manifest, timestamp))) {
        try {
            if (FileLib.exists(path)) FileLib.delete(path);
        } catch (_error) {}
        throw new Error(`could not write diff details '${path}'`);
    }
    return path;
}
