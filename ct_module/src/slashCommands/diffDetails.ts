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
    itemDifferences?: readonly {
        path: string;
        liveSnbt: string;
        sourceSnbt: string;
    }[];
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
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
    const itemBudget: ItemDiffBudget = { sections: 0, lines: 0, chars: 0 };
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
            lines.push("", itemDiff);
        }
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
