import type { Action, Importable } from "htsw/types";

import { actionListConflictVerdict } from "../housingSync/actions/conflicts";
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
import { printerDiagnosticsForDiff, type DiffPrinterDiagnostic } from "./diffDetails";
import { actionListContentHashFromActions } from "../housingSync/actions/scanHash";

type DiffReportConflict = ActionSyncConflict &
    ActionListConflictDetails & {
        canonicalDifferences: ActionListConflictDifference[];
        printerDiagnostics: DiffPrinterDiagnostic[];
    };

export type DiffReport = {
    clean: number;
    conflicts: DiffReportConflict[];
    unknown: number;
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
    identity: string;
    basePath: string;
    sourceActions: readonly Action[];
    liveActions: readonly Action[] | undefined;
};

export function matchDiffActionLists(
    sourceImportables: readonly Importable[],
    liveImportables: ReadonlyMap<string, Importable>
): DiffActionListMatch[] {
    const matches: DiffActionListMatch[] = [];
    for (const source of sourceImportables) {
        const identity = importableIdentity(source);
        const live = liveImportables.get(importableKey(source.type, identity));
        const liveListsByPath = live === undefined ? null : actionListsByPath(live);
        for (const sourceList of actionListsOfImportable(source)) {
            matches.push({
                source,
                live,
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
    lock: HouseLock | null
): DiffReport {
    const result: DiffReport = { clean: 0, conflicts: [], unknown: 0 };
    const matchingLock =
        lock !== null && (lock.houseUuid === null || lock.houseUuid === housingUuid)
            ? lock
            : null;

    for (const match of matches) {
        const liveActions = match.liveActions;
        if (liveActions === undefined) {
            result.unknown++;
            continue;
        }
        const lockEntry = houseLockEntryFor(
            matchingLock,
            match.source.type,
            match.identity
        );
        const verdict = actionListConflictVerdict(
            { actions: liveActions },
            {
                contentHash: lockEntry?.listContentHashes?.[match.basePath],
                scanHash: lockEntry?.listScanHashes?.[match.basePath],
            },
            match.sourceActions,
            "content"
        );
        if (
            verdict === "conflict" ||
            (verdict === "no-baseline" &&
                actionListContentHashFromActions(liveActions) !==
                    actionListContentHashFromActions(match.sourceActions))
        ) {
            const canonicalDifferences = actionListConflictDifferences(
                liveActions,
                match.sourceActions
            );
            result.conflicts.push({
                type: match.source.type,
                identity: match.identity,
                basePath: match.basePath,
                ...summarizeActionListConflictDifferences(canonicalDifferences),
                canonicalDifferences,
                printerDiagnostics: [
                    ...printerDiagnosticsForDiff("source", match.sourceActions),
                    ...printerDiagnosticsForDiff("live", liveActions),
                ],
            });
        } else if (verdict === null) {
            result.unknown++;
        } else {
            result.clean++;
        }
    }
    return result;
}

export function formatDiffReport(
    report: DiffReport,
    manifest: string,
    detailsPath?: string
): string[] {
    const lines = [
        `[htsw] Diff complete: ${report.clean} clean, ${report.conflicts.length} conflicts, ${report.unknown} unknown · ${manifest}`,
    ];
    const shown = Math.min(report.conflicts.length, 20);
    for (let i = 0; i < shown; i++) {
        const conflict = report.conflicts[i];
        lines.push(
            `[htsw] Conflict: ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`
        );
        for (const difference of conflict.differences) {
            lines.push(
                `[htsw]   ≠ ${difference.path}: live=${difference.live} · source=${difference.source}`
            );
        }
        if (conflict.moreCount > 0) {
            lines.push(`[htsw]   …and ${conflict.moreCount} more differences`);
        }
    }
    if (report.conflicts.length > shown) {
        lines.push(`[htsw] …and ${report.conflicts.length - shown} more conflicts`);
    }
    if (detailsPath !== undefined) {
        lines.push(`[htsw] Diff details: ${detailsPath}`);
    }
    return lines;
}
