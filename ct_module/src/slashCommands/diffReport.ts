import type { Action, Importable } from "htsw/types";

import { compareActionList } from "../housingSync/actions/conflicts";
import {
    actionListConflictDifferences,
    summarizeActionListConflictDifferences,
    type ActionListConflictDetails,
    type ActionListConflictDifference,
} from "../housingSync/actions/conflictDetails";
import type { ActionSyncConflict } from "../housingSync/actions/syncContext";
import {
    actionListsOfImportable,
    type ImportableActionList,
} from "../importCache/actionLists";
import { houseLockEntryFor, type HouseLock } from "../importCache/houseLock";
import { importableIdentity, importableKey } from "../importables/identity";
import {
    printerDiagnosticsForDiff,
    type DiffPrinterDiagnostic,
} from "../housingSync/actions/diffDetails";
import {
    sourceItemFieldContent,
    type ItemFieldContent,
} from "../housingSync/items/fieldContent";
import type { ProjectItemIndex } from "../importables/items/projectItems";

type DiffReportList = ActionSyncConflict &
    ActionListConflictDetails & {
        canonicalDifferences: ActionListConflictDifference[];
        printerDiagnostics: DiffPrinterDiagnostic[];
        sourceActions?: readonly Action[];
        liveActions?: readonly Action[];
    };

export type DiffReport = {
    clean: number;
    conflicts: DiffReportList[];
    pending: DiffReportList[];
    unknown: number;
};

export type LiveDiffImportable = {
    importable: Importable;
    itemContent: ItemFieldContent;
};

function liveActionsFor(
    source: Importable,
    live: Importable,
    sourceList: ImportableActionList,
    liveListsByPath: ReadonlyMap<string, readonly Action[]>
): readonly Action[] | undefined {
    if (source.type !== live.type) return undefined;
    if (source.type === "MENU" && live.type === "MENU") {
        const match = /^slots\[(\d+)\]\.actions$/.exec(sourceList.basePath);
        if (match === null) return undefined;
        const sourceSlot = source.slots[Number(match[1])];
        for (let i = 0; i < live.slots.length; i++) {
            const liveSlot = live.slots[i];
            if (liveSlot.slot === sourceSlot.slot) {
                return liveListsByPath.get(`slots[${i}].actions`) ?? [];
            }
        }
        return [];
    }
    return liveListsByPath.get(sourceList.basePath);
}

export type DiffActionListMatch = {
    source: Importable;
    live: Importable | undefined;
    liveItemContent: ItemFieldContent | undefined;
    identity: string;
    basePath: string;
    sourceActions: readonly Action[];
    liveActions: readonly Action[] | undefined;
};

export type DiffAdoptionList = Omit<
    DiffActionListMatch,
    "live" | "liveActions"
> & {
    live: Importable;
    liveActions: readonly Action[];
    reason: "drifted" | "untracked";
};

export type DiffEvaluation = {
    report: DiffReport;
    adoptionLists: DiffAdoptionList[];
};

export function matchDiffActionLists(
    sourceImportables: readonly Importable[],
    liveImportables: ReadonlyMap<string, LiveDiffImportable>
): DiffActionListMatch[] {
    const matches: DiffActionListMatch[] = [];
    for (const source of sourceImportables) {
        const identity = importableIdentity(source);
        const liveEntry = liveImportables.get(importableKey(source.type, identity));
        const live = liveEntry?.importable;
        const liveListsByPath = live === undefined ? null : actionListsByPath(live);
        for (const sourceList of actionListsOfImportable(source)) {
            matches.push({
                source,
                live,
                liveItemContent: liveEntry?.itemContent,
                identity,
                basePath: sourceList.basePath,
                sourceActions: sourceList.actions,
                liveActions:
                    live === undefined || liveListsByPath === null
                        ? undefined
                        : liveActionsFor(source, live, sourceList, liveListsByPath),
            });
        }
    }
    return matches;
}

function actionListsByPath(importable: Importable): Map<string, readonly Action[]> {
    const byPath = new Map<string, readonly Action[]>();
    for (const list of actionListsOfImportable(importable)) {
        byPath.set(list.basePath, list.actions);
    }
    return byPath;
}

export function evaluateDiffReport(
    housingUuid: string,
    matches: readonly DiffActionListMatch[],
    lock: HouseLock | null,
    projectItems?: ProjectItemIndex
): DiffEvaluation {
    const report: DiffReport = {
        clean: 0,
        conflicts: [],
        pending: [],
        unknown: 0,
    };
    const adoptionLists: DiffAdoptionList[] = [];

    for (const match of matches) {
        const liveActions = match.liveActions;
        if (liveActions === undefined) {
            report.unknown++;
            continue;
        }
        const { comparison, sourceItemContent } = diffActionListComparison(
            housingUuid,
            match,
            lock,
            projectItems
        );
        if (comparison === null) {
            report.unknown++;
            continue;
        }
        const verdict = comparison.verdict;
        const adoptionReason =
            verdict === "no-baseline"
                ? "untracked"
                : verdict === "conflict" || verdict === "already-applied"
                  ? "drifted"
                  : null;
        if (match.live !== undefined && adoptionReason !== null) {
            adoptionLists.push({
                ...match,
                live: match.live,
                liveActions,
                reason: adoptionReason,
            });
        }
        if (
            verdict === "conflict" ||
            (verdict === "no-baseline" && comparison.sourceDiffersFromLive)
        ) {
            report.conflicts.push(
                diffReportList(match, liveActions, sourceItemContent)
            );
        } else {
            report.clean++;
            if (comparison.sourceDiffersFromLive) {
                report.pending.push(
                    diffReportList(match, liveActions, sourceItemContent)
                );
            }
        }
    }
    return { report, adoptionLists };
}

function diffReportList(
    match: DiffActionListMatch,
    liveActions: readonly Action[],
    sourceItemContent: ItemFieldContent | undefined
): DiffReportList {
    const canonicalDifferences = actionListConflictDifferences(
        liveActions,
        match.sourceActions,
        match.liveItemContent,
        sourceItemContent
    );
    return {
        type: match.source.type,
        identity: match.identity,
        basePath: match.basePath,
        ...summarizeActionListConflictDifferences(canonicalDifferences),
        canonicalDifferences,
        printerDiagnostics: [
            ...printerDiagnosticsForDiff("source", match.sourceActions),
            ...printerDiagnosticsForDiff("live", liveActions),
        ],
        sourceActions: match.sourceActions,
        liveActions,
    };
}

function diffActionListComparison(
    housingUuid: string,
    match: DiffActionListMatch,
    lock: HouseLock | null,
    projectItems?: ProjectItemIndex
) {
    const matchingLock =
        lock !== null && (lock.houseUuid === null || lock.houseUuid === housingUuid)
            ? lock
            : null;
    const lockEntry = houseLockEntryFor(
        matchingLock,
        match.source.type,
        match.identity
    );
    const sourceItemContent =
        projectItems === undefined
            ? undefined
            : sourceItemFieldContent(match.source, projectItems);
    return {
        comparison:
            match.liveActions === undefined
                ? null
                : compareActionList(
                      { actions: match.liveActions },
                      {
                          contentHash:
                              lockEntry?.listContentHashes?.[match.basePath],
                          scanHash: lockEntry?.listScanHashes?.[match.basePath],
                      },
                      match.sourceActions,
                      "content",
                      match.liveItemContent,
                      sourceItemContent
                  ),
        sourceItemContent,
    };
}

export function formatDiffReport(
    report: DiffReport,
    manifest: string
): string[] {
    const lines = [
        `[htsw] Diff complete: ${report.clean} clean, ${report.conflicts.length} conflicts, ${report.unknown} unknown · ${manifest}`,
    ];
    appendDiffReportLists(lines, report.conflicts, "Conflict", "conflicts");
    if (report.pending.length > 0) {
        lines.push(`[htsw] Pending changes: ${report.pending.length}`);
        appendDiffReportLists(
            lines,
            report.pending,
            "Pending",
            "pending changes"
        );
    }
    return lines;
}

function appendDiffReportLists(
    lines: string[],
    lists: readonly DiffReportList[],
    label: string,
    overflowLabel: string
): void {
    const shown = Math.min(lists.length, 20);
    for (let i = 0; i < shown; i++) {
        const list = lists[i];
        lines.push(
            `[htsw] ${label}: ${list.type} "${list.identity}" · ${list.basePath}`
        );
        for (const difference of list.differences) {
            lines.push(
                `[htsw]   ≠ ${difference.path}: live=${difference.live} · source=${difference.source}`
            );
        }
        if (list.moreCount > 0) {
            lines.push(`[htsw]   …and ${list.moreCount} more differences`);
        }
    }
    if (lists.length > shown) {
        lines.push(`[htsw] …and ${lists.length - shown} more ${overflowLabel}`);
    }
}
