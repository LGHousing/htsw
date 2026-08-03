import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";

import { parentDirOf } from "../../project/paths";
import { atomicWriteText } from "../../utils/filesystem";
import type { ActionListConflictDifference } from "./conflictDetails";
import type {
    ActionSyncConflict,
    ActionSyncConflictEvidence,
} from "./syncContext";

export type DiffPrinterDiagnostic = {
    side: "source" | "live";
    level: "warning";
    message: string;
};

type DiffDetailsList = {
    type: Importable["type"];
    identity: string;
    basePath: string;
    canonicalDifferences: readonly ActionListConflictDifference[];
    printerDiagnostics: readonly DiffPrinterDiagnostic[];
    baselineKnown?: boolean;
    baselineActions?: readonly Action[];
    housingChangesSinceBaseline?: readonly ActionListConflictDifference[];
    projectChangesSinceBaseline?: readonly ActionListConflictDifference[];
    sourceActions?: readonly Action[];
    liveActions?: readonly Action[];
};

export type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsList[];
    pending: readonly DiffDetailsList[];
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

export function diffDetailsReportForImportConflicts(
    conflicts: readonly ActionSyncConflict[],
    evidence: readonly ActionSyncConflictEvidence[]
): DiffDetailsReport {
    const evidenceByTarget = new Map<string, ActionSyncConflictEvidence>();
    for (const entry of evidence) {
        evidenceByTarget.set(conflictKey(entry), entry);
    }

    let unknown = 0;
    const lists = conflicts.map((conflict): DiffDetailsList => {
        const entry = evidenceByTarget.get(conflictKey(conflict));
        if (entry === undefined) {
            unknown++;
            return {
                ...conflict,
                canonicalDifferences: [],
                printerDiagnostics: [],
            };
        }
        return {
            type: entry.type,
            identity: entry.identity,
            basePath: entry.basePath,
            canonicalDifferences: entry.canonicalDifferences,
            printerDiagnostics: [
                ...printerDiagnosticsForDiff("source", entry.sourceActions),
                ...printerDiagnosticsForDiff("live", entry.liveActions),
            ],
            baselineKnown: entry.baselineActions !== undefined,
            baselineActions: entry.baselineActions,
            housingChangesSinceBaseline: entry.housingChangesSinceBaseline,
            projectChangesSinceBaseline: entry.projectChangesSinceBaseline,
            sourceActions: entry.sourceActions,
            liveActions: entry.liveActions,
        };
    });

    return {
        clean: 0,
        conflicts: lists,
        pending: [],
        unknown,
    };
}

function conflictKey(conflict: ActionSyncConflict): string {
    return `${conflict.type}:${conflict.identity}:${conflict.basePath}`;
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
        `# pending changes: ${report.pending.length}`,
        `# unknown: ${report.unknown}`,
        "# Field differences compare the labeled action-list snapshots.",
    ];
    appendDiffDetailsLists(lines, report.conflicts);
    if (report.pending.length > 0) {
        lines.push("", "# PENDING CHANGES");
        appendDiffDetailsLists(lines, report.pending);
    }
    return lines.join("\n") + "\n";
}

function appendDiffDetailsLists(
    lines: string[],
    lists: readonly DiffDetailsList[]
): void {
    for (const list of lists) {
        lines.push("", `# ${list.type} "${list.identity}" · ${list.basePath}`);
        for (const diagnostic of list.printerDiagnostics) {
            lines.push(
                `# HTSL printer ${diagnostic.level} (${diagnostic.side}): ${diagnostic.message}`
            );
        }
        if (list.baselineKnown === true) {
            appendCanonicalDifferences(
                lines,
                "HOUSING CHANGES SINCE LAST IMPORT",
                `last-import/${list.basePath}`,
                `live/${list.basePath}`,
                list.housingChangesSinceBaseline ?? []
            );
            appendCanonicalDifferences(
                lines,
                "PROJECT CHANGES SINCE LAST IMPORT",
                `last-import/${list.basePath}`,
                `source/${list.basePath}`,
                list.projectChangesSinceBaseline ?? []
            );
        } else if (list.baselineKnown === false) {
            lines.push(
                "# Exact last-import values unavailable; house.lock.json retained hashes for this list."
            );
        }
        appendCanonicalDifferences(
            lines,
            list.baselineKnown === undefined
                ? undefined
                : "PROJECT SOURCE VS LIVE HOUSING",
            `source/${list.basePath}`,
            `live/${list.basePath}`,
            list.canonicalDifferences
        );
        appendActionSnapshots(lines, list);
    }
}

function appendCanonicalDifferences(
    lines: string[],
    heading: string | undefined,
    from: string,
    to: string,
    differences: readonly ActionListConflictDifference[]
): void {
    if (heading !== undefined) lines.push(`# ${heading}`);
    if (differences.length === 0) {
        lines.push("# No renderable canonical field differences.");
        return;
    }
    lines.push(`--- ${from}`, `+++ ${to}`);
    for (const difference of differences) {
        lines.push(
            ` ${difference.path}`,
            `-  ${difference.source}`,
            `+  ${difference.live}`
        );
    }
}

function appendActionSnapshots(lines: string[], list: DiffDetailsList): void {
    if (list.sourceActions === undefined || list.liveActions === undefined) return;
    if (list.baselineActions !== undefined) {
        const baseline = htsw.htsl.printActionsWithDiagnostics(
            list.baselineActions
        ).source;
        lines.push(
            "",
            "# COMPLETE LAST IMPORT HTSL",
            baseline.replace(/\n$/, "")
        );
    }
    const source = htsw.htsl.printActionsWithDiagnostics(list.sourceActions).source;
    const live = htsw.htsl.printActionsWithDiagnostics(list.liveActions).source;
    lines.push(
        "",
        "# COMPLETE SOURCE HTSL",
        source.replace(/\n$/, ""),
        "",
        "# COMPLETE LIVE HTSL",
        live.replace(/\n$/, "")
    );
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
