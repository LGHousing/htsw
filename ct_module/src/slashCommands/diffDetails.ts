import * as htsw from "htsw";
import type { Action, Importable } from "htsw/types";

import { parentDirOf } from "../project/paths";
import { atomicWriteText } from "../utils/filesystem";
import { unifiedDiff } from "./unifiedDiff";

type DiffDetailsConflict = {
    type: Importable["type"];
    identity: string;
    basePath: string;
    sourceText: string;
    liveText: string;
    differences: readonly { path: string; live: string; source: string }[];
    itemDifferences?: readonly {
        path: string;
        liveSnbt: string;
        sourceSnbt: string;
    }[];
    moreCount: number;
    revertsTo?: string;
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    pendingChanges?: readonly DiffDetailsConflict[];
    unknown: number;
    staleBaselineDays?: number;
};

function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
}

function boundedItemSnbt(text: string): string {
    const lines = text.split("\n");
    const shown = lines.slice(0, 120).join("\n");
    const bounded = shown.length > 12000 ? shown.substring(0, 12000) : shown;
    return bounded === text ? text : `${bounded}\n# …item diff truncated`;
}

export function renderActionsForDiff(actions: readonly Action[]): string {
    return htsw.htsl.printActionsWithDiagnostics(actions).source;
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
    ];
    if (report.staleBaselineDays !== undefined) {
        lines.push(
            `# WARNING: Package baseline is ${report.staleBaselineDays} days old — verify against current canonical before importing.`
        );
    }
    appendListDiffs(lines, report.conflicts);
    if ((report.pendingChanges?.length ?? 0) > 0) {
        lines.push("", "# PENDING CHANGES (what this import will write)");
        appendListDiffs(lines, report.pendingChanges ?? []);
    }
    return lines.join("\n") + "\n";
}

function appendListDiffs(lines: string[], lists: readonly DiffDetailsConflict[]): void {
    for (const conflict of lists) {
        const diff = unifiedDiff(
            conflict.sourceText,
            conflict.liveText,
            `source/${conflict.basePath}`,
            `live/${conflict.basePath}`
        );
        lines.push(
            "",
            `# ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`
        );
        if (conflict.revertsTo !== undefined) {
            lines.push(`# ⚠ reverts to recorded state from ${conflict.revertsTo}`);
        }
        for (const difference of conflict.differences) {
            lines.push(
                `# ≠ ${difference.path}: live=${difference.live} · source=${difference.source}`
            );
        }
        if (conflict.moreCount > 0) {
            lines.push(`# …and ${conflict.moreCount} more differences`);
        }
        lines.push(withoutFinalNewline(diff));
        for (const item of conflict.itemDifferences ?? []) {
            lines.push(
                "",
                `# item · ${item.path}`,
                withoutFinalNewline(
                    unifiedDiff(
                        boundedItemSnbt(item.sourceSnbt),
                        boundedItemSnbt(item.liveSnbt),
                        `source/${conflict.basePath}/${item.path}.snbt`,
                        `live/${conflict.basePath}/${item.path}.snbt`
                    )
                )
            );
        }
    }
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
