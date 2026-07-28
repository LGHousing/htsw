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
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    unknown: number;
};

function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
}

const MAX_ITEM_DIFF_SECTIONS = 5;
const MAX_ITEM_DIFF_LINES = 120;
const MAX_ITEM_DIFF_CHARS = 12000;
const ITEM_DIFF_TRUNCATED = "# …item diff truncated";

type ItemDiffBudget = {
    sections: number;
    lines: number;
    chars: number;
};

function boundedItemDiff(text: string, budget: ItemDiffBudget): string {
    const availableLines = MAX_ITEM_DIFF_LINES - budget.lines;
    const availableChars = MAX_ITEM_DIFF_CHARS - budget.chars;
    if (availableLines <= 0 || availableChars <= 0) return "";

    const inputLines = text.split("\n");
    const fits =
        inputLines.length <= availableLines && text.length <= availableChars;
    let bounded = text;
    if (!fits) {
        const contentLines = Math.max(0, availableLines - 1);
        bounded = inputLines.slice(0, contentLines).join("\n");
        const contentChars = Math.max(
            0,
            availableChars -
                ITEM_DIFF_TRUNCATED.length -
                (bounded.length > 0 ? 1 : 0)
        );
        if (bounded.length > contentChars) {
            bounded = bounded.substring(0, contentChars);
        }
        bounded =
            bounded.length === 0
                ? ITEM_DIFF_TRUNCATED.substring(0, availableChars)
                : `${bounded}\n${ITEM_DIFF_TRUNCATED}`;
    }

    budget.sections++;
    budget.lines += bounded.split("\n").length;
    budget.chars += bounded.length;
    return bounded;
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
    const itemBudget: ItemDiffBudget = { sections: 0, lines: 0, chars: 0 };
    for (const conflict of report.conflicts) {
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
        for (const difference of conflict.differences) {
            lines.push(
                `# ≠ ${difference.path}: live=${difference.live} · source=${difference.source}`
            );
        }
        if (conflict.moreCount > 0) {
            lines.push(`# …and ${conflict.moreCount} more differences`);
        }
        lines.push(
            withoutFinalNewline(diff)
        );
        for (const item of conflict.itemDifferences ?? []) {
            if (itemBudget.sections === MAX_ITEM_DIFF_SECTIONS) break;
            const itemDiff = boundedItemDiff(
                [
                    `# item · ${item.path}`,
                    withoutFinalNewline(
                        unifiedDiff(
                            item.sourceSnbt,
                            item.liveSnbt,
                            `source/${conflict.basePath}/${item.path}.snbt`,
                            `live/${conflict.basePath}/${item.path}.snbt`
                        )
                    ),
                ].join("\n"),
                itemBudget
            );
            if (itemDiff.length === 0) break;
            lines.push(
                "",
                itemDiff
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
        throw new Error(`could not write diff details '${path}'`);
    }
    return path;
}
