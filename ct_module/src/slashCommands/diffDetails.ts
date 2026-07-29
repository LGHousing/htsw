import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";

import type { ActionListConflictDifference } from "../housingSync/actions/conflictDetails";
import { parentDirOf } from "../project/paths";
import { atomicWriteText } from "../utils/filesystem";
import { runtimeString } from "../utils/java";
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
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    unknown: number;
};

export type ImportCancelEvidence = {
    type: Importable["type"];
    identity: string;
    basePath: string;
    expectedActions: readonly Action[];
    liveActions?: readonly Action[];
    liveScanHash: string;
    expectedScanHash: string;
};

function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
}

function renderActionsForDiff(actions: readonly Action[]): string {
    return htsw.htsl.printActionsWithDiagnostics(actions).source;
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

export function formatImportCancelEvidence(
    evidence: readonly ImportCancelEvidence[]
): string {
    const lines = ["", "# IMPORT CANCELLED - CONFLICT AT APPLY TIME"];
    for (const entry of evidence) {
        lines.push("", `# ${entry.type} "${entry.identity}" · ${entry.basePath}`);
        if (entry.liveActions === undefined) {
            lines.push(
                "# Full live content was not hydrated at cancellation; scan-level evidence only.",
                `# live scan hash: ${entry.liveScanHash}`,
                `# expected scan hash: ${entry.expectedScanHash}`
            );
            continue;
        }
        lines.push(
            withoutFinalNewline(
                unifiedDiff(
                    renderActionsForDiff(entry.expectedActions),
                    renderActionsForDiff(entry.liveActions),
                    `expected/${entry.basePath}`,
                    `live/${entry.basePath}`
                )
            )
        );
    }
    return lines.join("\n") + "\n";
}

export function appendImportCancelEvidence(
    manifest: string,
    evidence: readonly ImportCancelEvidence[]
): string {
    const path = diffDetailsPath(manifest);
    const existing = FileLib.exists(path) ? runtimeString(FileLib.read(path)) : "";
    const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    if (
        !atomicWriteText(
            path,
            existing + separator + formatImportCancelEvidence(evidence)
        )
    ) {
        throw new Error(`could not write import cancellation evidence '${path}'`);
    }
    return path;
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
        const sourceText = canonicalDifferenceText(
            conflict.canonicalDifferences,
            "source"
        );
        const liveText = canonicalDifferenceText(conflict.canonicalDifferences, "live");
        const diff = unifiedDiff(
            sourceText,
            liveText,
            `source/${conflict.basePath}`,
            `live/${conflict.basePath}`
        );
        lines.push("", `# ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`);
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
    return lines.join("\n") + "\n";
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
