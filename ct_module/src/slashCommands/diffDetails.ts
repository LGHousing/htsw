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
        const beforeText = liveToSource ? conflict.liveText : conflict.sourceText;
        const afterText = liveToSource ? conflict.sourceText : conflict.liveText;
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
                        boundedItemSnbt(
                            liveToSource ? item.liveSnbt : item.sourceSnbt
                        ),
                        boundedItemSnbt(
                            liveToSource ? item.sourceSnbt : item.liveSnbt
                        ),
                        `${beforeLabel}/${conflict.basePath}/${item.path}.snbt`,
                        `${afterLabel}/${conflict.basePath}/${item.path}.snbt`
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
