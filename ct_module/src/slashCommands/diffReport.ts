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
import {
    houseLockEntryFor,
    recordedRevertDate,
    type HouseLock,
} from "../importCache/houseLock";
import { importableIdentity, importableKey } from "../importables/identity";
import { actionListContentHashFromActions } from "../housingSync/actions/scanHash";
import {
    capturedItemFieldContent,
    sourceItemFieldContent,
} from "../housingSync/items/fieldContent";
import type { ProjectItemIndex } from "../importables/items/projectItems";
import type { CapturedItem } from "../importables/items/captureRegistry";
import { printerDiagnosticsForDiff, type DiffPrinterDiagnostic } from "./diffDetails";

type DiffReportList = ActionSyncConflict &
    ActionListConflictDetails & {
        canonicalDifferences: ActionListConflictDifference[];
        printerDiagnostics: DiffPrinterDiagnostic[];
        revertsTo?: string;
    };

export type DiffReport = {
    clean: number;
    conflicts: DiffReportList[];
    pendingChanges?: DiffReportList[];
    unknown: number;
    revertCount?: number;
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

export type MatchedLiveActionList = {
    source: Importable;
    live: Importable;
    identity: string;
    basePath: string;
    actions: readonly Action[];
};

export function matchedLiveActionLists(
    sourceImportables: readonly Importable[],
    liveImportables: ReadonlyMap<string, Importable>
): MatchedLiveActionList[] {
    const matched: MatchedLiveActionList[] = [];
    for (const source of sourceImportables) {
        const identity = importableIdentity(source);
        const live = liveImportables.get(importableKey(source.type, identity));
        if (live === undefined) continue;
        const liveListsByPath = actionListsByPath(live);
        for (const sourceList of actionListsOfImportable(source)) {
            const actions = liveActionsFor(source, live, sourceList, liveListsByPath);
            if (actions !== undefined) {
                matched.push({
                    source,
                    live,
                    identity,
                    basePath: sourceList.basePath,
                    actions,
                });
            }
        }
    }
    return matched;
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
    sourceImportables: readonly Importable[],
    liveImportables: ReadonlyMap<string, Importable>,
    lock: HouseLock | null,
    itemContent?: {
        projectItems: ProjectItemIndex;
        captures: ReadonlyMap<string, CapturedItem>;
    }
): DiffReport {
    const result: DiffReport = {
        clean: 0,
        conflicts: [],
        unknown: 0,
    };
    const matchingLock =
        lock !== null && (lock.houseUuid === null || lock.houseUuid === housingUuid)
            ? lock
            : null;

    for (const source of sourceImportables) {
        const identity = importableIdentity(source);
        const live = liveImportables.get(importableKey(source.type, identity));
        const sourceItems =
            itemContent === undefined
                ? undefined
                : sourceItemFieldContent(source, itemContent.projectItems);
        const liveItems =
            live === undefined || itemContent === undefined
                ? undefined
                : capturedItemFieldContent(live, itemContent.captures);
        const lockEntry = houseLockEntryFor(matchingLock, source.type, identity);
        const liveListsByPath = live === undefined ? null : actionListsByPath(live);
        for (const sourceList of actionListsOfImportable(source)) {
            const liveActions =
                live === undefined || liveListsByPath === null
                    ? undefined
                    : liveActionsFor(source, live, sourceList, liveListsByPath);
            if (liveActions === undefined) {
                result.unknown++;
                continue;
            }
            const verdict = actionListConflictVerdict(
                { actions: liveActions },
                {
                    contentHash: lockEntry?.listContentHashes?.[sourceList.basePath],
                    scanHash: lockEntry?.listScanHashes?.[sourceList.basePath],
                },
                sourceList.actions,
                "content",
                liveItems,
                sourceItems
            );
            const liveHash = actionListContentHashFromActions(liveActions, liveItems);
            const sourceHash = actionListContentHashFromActions(
                sourceList.actions,
                sourceItems
            );
            const revertsTo = recordedRevertDate(
                lockEntry?.listContentHashJournal?.[sourceList.basePath],
                sourceHash,
                liveHash
            );
            const details = (): DiffReportList => {
                const canonicalDifferences = actionListConflictDifferences(
                    liveActions,
                    sourceList.actions,
                    liveItems,
                    sourceItems
                );
                return {
                    type: source.type,
                    identity,
                    basePath: sourceList.basePath,
                    ...summarizeActionListConflictDifferences(
                        canonicalDifferences
                    ),
                    canonicalDifferences,
                    printerDiagnostics: [
                        ...printerDiagnosticsForDiff("source", sourceList.actions),
                        ...printerDiagnosticsForDiff("live", liveActions),
                    ],
                    ...(revertsTo === undefined ? {} : { revertsTo }),
                };
            };
            if (
                verdict === "conflict" ||
                (verdict === "no-baseline" && liveHash !== sourceHash)
            ) {
                result.conflicts.push(details());
            } else if (verdict === null) {
                result.unknown++;
            } else {
                result.clean++;
                if (sourceHash !== liveHash) {
                    (result.pendingChanges ??= []).push(details());
                }
            }
            if (revertsTo !== undefined)
                result.revertCount = (result.revertCount ?? 0) + 1;
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
    if ((report.pendingChanges?.length ?? 0) > 0) {
        const pendingCount = report.pendingChanges?.length ?? 0;
        lines.push(
            `[htsw] Pending changes: ${pendingCount} list${pendingCount === 1 ? "" : "s"} will be modified`
        );
    }
    if ((report.revertCount ?? 0) > 0) {
        const revertCount = report.revertCount ?? 0;
        lines.push(
            `[htsw] Warning: ${revertCount} list${revertCount === 1 ? "" : "s"} would revert to ${revertCount === 1 ? "an " : ""}older recorded state${revertCount === 1 ? "" : "s"}.`
        );
    }
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

export function formatDiffProgress(report: DiffReport): string {
    const pending = report.pendingChanges?.length ?? 0;
    const unchanged = Math.max(0, report.clean - pending);
    const reverts = report.revertCount ?? 0;
    const conflicts = report.conflicts.length;
    return `${unchanged} unchanged / ${pending} pending / ${conflicts} conflict${conflicts === 1 ? "" : "s"} / ${report.unknown} unknown / ${reverts} rollback warning${reverts === 1 ? "" : "s"}`;
}
