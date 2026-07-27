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
};

type DiffDetailsReport = {
    clean: number;
    conflicts: readonly DiffDetailsConflict[];
    unknown: number;
};

function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.substring(0, text.length - 1) : text;
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
    for (const conflict of report.conflicts) {
        const diff = unifiedDiff(
            conflict.sourceText,
            conflict.liveText,
            `source/${conflict.basePath}`,
            `live/${conflict.basePath}`
        );
        lines.push(
            "",
            `# ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`,
            withoutFinalNewline(diff)
        );
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
