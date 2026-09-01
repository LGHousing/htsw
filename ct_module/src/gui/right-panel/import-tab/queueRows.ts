/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import type { ClickInfo, Element } from "../../lib/layout";
import { Container, Icon, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import { openMenu, type MenuAction } from "../../lib/menu";
import { shortPath } from "../../lib/pathDisplay";
import { buildCacheStatusRow } from "../../../importCache/status";
import { listCachedImportables } from "../../../importCache/cache";
import { importableIdentity } from "../../../importables/identity";
import { isTaskRunning } from "../../../tasks/runningState";
import { getHousingUuid, isCurrentHouseTrusted } from "../../state";
import { isHouseTrusted } from "../../state/trust";
import { canonicalPath, requestParse } from "../../parsing/parses";
import { setActiveLeftTab } from "../../left-panel/tabs";
import { revealInProjectsTree } from "../../left-panel/projects/tree";
import { currentSnapshotSegments, parkedSnapshotSegments } from "./progressPanel";
import { PHASE_APPLYING, PHASE_HYDRATING, PHASE_READING } from "./phaseColors";
import {
    getQueueRowRunState,
    isCurrentQueueRow,
    type QueueRowRunState,
} from "./taskProgress";
import {
    dismissQueueRow,
    getQueue,
    getQueueRowBadge,
    removeQueueRow,
    retryQueueRow,
    type QueueRow,
} from "./queue";
import { cancelQueue } from "./queueRunner";

const collapsedBulkRows = new Set<string>();

export function queueRowCacheSizes(): {
    sourceIndexes: number;
    skipPredictions: number;
} {
    return { sourceIndexes: 0, skipPredictions: 0 };
}

export function queueBulkChildren(row: QueueRow): QueueRow[] {
    if (row.target.kind !== "bulk") return [];
    return getQueue().filter((candidate) => candidate.parentKey === row.key);
}

export function isQueueBulkExpanded(row: QueueRow): boolean {
    return (
        row.target.kind === "bulk" &&
        queueBulkChildren(row).length > 0 &&
        !collapsedBulkRows.has(row.key)
    );
}

function sourceImportables(path: string): readonly Importable[] {
    return requestParse(path)?.parsed?.value ?? [];
}

function cacheStateMatches(row: QueueRow, house: string | null, imp: Importable): boolean {
    if (row.target.kind !== "bulk") return true;
    if (row.target.filter === "all" || row.target.filter === "new") return true;
    const state = house === null ? "unknown" : buildCacheStatusRow(house, imp).state;
    if (row.target.filter === "modified") return state !== "current";
    return house !== null && isHouseTrusted(house) && state === "modified";
}

function bulkLiveCount(row: QueueRow): number {
    if (row.target.kind !== "bulk") return 0;
    const children = queueBulkChildren(row);
    if (children.length > 0) return children.length;
    const house = row.house ?? getHousingUuid();
    const scopePath =
        row.target.scope.kind === "file" ? row.target.scope.path : row.path;
    const values = sourceImportables(scopePath);
    if (row.target.scope.kind === "file") {
        return values.filter((imp) => cacheStateMatches(row, house, imp)).length;
    }
    const type = row.target.scope.type;
    const local = values.filter((imp) => imp.type === type);
    const live = listCachedImportables(house, type);
    if (row.target.filter === "new") {
        const declared = new Set(local.map(importableIdentity));
        return live.filter((entry) => !declared.has(entry.name)).length;
    }
    if (row.op === "import") {
        return local.filter((imp) => cacheStateMatches(row, house, imp)).length;
    }
    if (row.target.filter === "changed") {
        const liveNames = new Set(live.map((entry) => entry.name));
        return local.filter(
            (imp) =>
                liveNames.has(importableIdentity(imp)) &&
                cacheStateMatches(row, house, imp)
        ).length;
    }
    return live.length;
}

function operationVisual(op: QueueRow["op"]): {
    icon: (typeof Icons)[keyof typeof Icons];
    color: number;
} {
    if (op === "import") return { icon: Icons.arrowDownToLine, color: PHASE_APPLYING };
    if (op === "export") return { icon: Icons.arrowUpFromLine, color: PHASE_HYDRATING };
    return { icon: Icons.scanEye, color: PHASE_READING };
}

function phaseColor(phase: "reading" | "hydrating" | "applying"): number {
    if (phase === "applying") return PHASE_APPLYING;
    if (phase === "hydrating") return PHASE_HYDRATING;
    return PHASE_READING;
}

function queueStateRail(color: number | undefined): Element {
    return Container({
        style: {
            width: { kind: "px", value: 2 },
            height: { kind: "grow" },
            background: color,
        },
        children: [],
    });
}

function queueRowMiniBar(state: QueueRowRunState): Element {
    if (state.kind === "queued") {
        return Container({
            style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
            children: [],
        });
    }
    if (state.kind === "done" || state.kind === "skipped" || state.kind === "failed") {
        const color =
            state.kind === "done"
                ? ACCENT_SUCCESS
                : state.kind === "skipped"
                  ? ACCENT_TEAL
                  : ACCENT_DANGER;
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: color,
            },
            children: [],
        });
    }
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 2 },
        },
        children:
            state.kind === "parked"
                ? parkedSnapshotSegments(state, "slices")
                : currentSnapshotSegments(state, "slices"),
    });
}

function rowMessage(row: QueueRow): string | null {
    if (row.status === "failed") return `Failed: ${row.error ?? "Unknown error"}`;
    if (row.status !== "cancelled") return null;
    if (row.error === null || row.error === "") return "Cancelled";
    return row.error.toLowerCase().startsWith("cancelled")
        ? row.error
        : `Cancelled: ${row.error}`;
}

function rowHasRunningWork(row: QueueRow): boolean {
    return row.target.kind === "importable"
        ? row.status === "running"
        : queueBulkChildren(row).some((child) => child.status === "running");
}

function rowMenuActions(row: QueueRow): MenuAction[] {
    if (row.status === "failed" || row.status === "cancelled") {
        return [
            { label: "Retry", icon: Icons.rotateCcw, onClick: () => retryQueueRow(row.key) },
            { label: "Dismiss", icon: Icons.x, onClick: () => dismissQueueRow(row.key) },
        ];
    }
    if (rowHasRunningWork(row)) {
        return [{ label: "Cancel", icon: Icons.square, onClick: () => cancelQueue() }];
    }
    return [
        {
            label: row.target.kind === "bulk" ? "Remove group" : "Remove",
            icon: Icons.x,
            onClick: () => removeQueueRow(row.key),
        },
    ];
}

function rowControls(row: QueueRow): Element {
    const retry = row.status === "failed" || row.status === "cancelled";
    const controls: Element[] = [];
    if (retry) {
        controls.push(
            Container({
                style: {
                    direction: "col",
                    align: "center",
                    justify: "center",
                    width: { kind: "px", value: 14 },
                    height: { kind: "grow" },
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button === 0) retryQueueRow(row.key);
                },
                children: [Icon({ name: Icons.rotateCcw, tooltip: "Retry" })],
            })
        );
    }
    controls.push(
        Container({
            style: {
                direction: "col",
                align: "center",
                justify: "center",
                width: { kind: "px", value: 14 },
                height: { kind: "grow" },
                hoverBackground: 0x40e85c5c | 0,
            },
            onClick: (_rect, info) => {
                if (info.button !== 0) return;
                if (rowHasRunningWork(row)) cancelQueue();
                else if (retry) dismissQueueRow(row.key);
                else removeQueueRow(row.key);
            },
            children: [
                Icon({
                    name: Icons.x,
                    tooltip: rowHasRunningWork(row)
                        ? "Cancel current queue session"
                        : retry
                          ? "Dismiss"
                          : "Remove from queue",
                    tooltipColor: ACCENT_DANGER,
                }),
            ],
        })
    );
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: controls.length * 14 },
            height: { kind: "grow" },
        },
        children: controls,
    });
}

function statusIcon(row: QueueRow, runState: QueueRowRunState): Element {
    const visual =
        row.status === "failed"
            ? { icon: Icons.circleX, color: ACCENT_DANGER, label: "Failed" }
            : row.status === "cancelled"
              ? { icon: Icons.ban, color: COLOR_TEXT_FAINT, label: "Cancelled" }
              : runState.kind === "done" || runState.kind === "skipped"
                ? { icon: Icons.circleCheck, color: ACCENT_SUCCESS, label: "Done" }
                : row.status === "running"
                  ? {
                        icon: Icons.play,
                        color: operationVisual(row.op).color,
                        label: "Running",
                    }
                  : { icon: Icons.clock, color: COLOR_TEXT_DIM, label: "Queued" };
    return Icon({
        name: visual.icon,
        color: visual.color,
        tooltip: row.error === null ? visual.label : `${visual.label}: ${row.error}`,
        tooltipColor: visual.color,
        style: { width: { kind: "px", value: 12 }, height: { kind: "px", value: 12 } },
    });
}

function revealQueueRow(row: QueueRow, info: ClickInfo): void {
    if (info.button !== 0 || info.isDoubleClickSecond) return;
    setActiveLeftTab("projects");
    if (row.op === "import" && row.target.kind === "importable") {
        revealInProjectsTree({
            kind: "importable",
            declaringImportJson: row.path,
            type: row.target.type,
            identity: row.target.identity,
        });
    } else {
        revealInProjectsTree({ kind: "file", importJsonPath: row.path });
    }
}

function willSkip(row: QueueRow): boolean {
    if (
        isTaskRunning() ||
        !isCurrentHouseTrusted() ||
        row.op !== "import" ||
        row.target.kind !== "importable"
    ) {
        return false;
    }
    const house = getHousingUuid();
    if (house === null) return false;
    const target = row.target;
    const imp = sourceImportables(row.path).find(
        (candidate) =>
            candidate.type === target.type &&
            importableIdentity(candidate) === target.identity
    );
    return imp !== undefined && buildCacheStatusRow(house, imp).state === "current";
}

export type QueueRowRenderOptions = { child?: boolean; dimmed?: boolean };

export function queueRow(row: QueueRow, options: QueueRowRenderOptions = {}): Element {
    const child = options.child === true;
    const dimmed = options.dimmed === true;
    const runState = getQueueRowRunState(row);
    const skip = runState.kind === "skipped" || willSkip(row);
    const children = queueBulkChildren(row);
    const canExpand = row.target.kind === "bulk" && children.length > 0;
    const expanded = canExpand && isQueueBulkExpanded(row);
    const message = rowMessage(row);
    const op = operationVisual(row.op);
    const badge = getQueueRowBadge(row);
    const typeLabel =
        row.target.kind === "importable"
            ? row.target.type
            : row.target.scope.kind === "houseType"
              ? row.target.scope.type
              : "ALL";
    const label =
        row.target.kind === "bulk"
            ? `${row.target.label} (${bulkLiveCount(row)})`
            : row.target.label;
    const stateColor =
        row.status === "failed"
            ? ACCENT_DANGER
            : row.status === "cancelled"
              ? COLOR_TEXT_FAINT
              : runState.kind === "current"
                ? phaseColor(runState.phase)
                : undefined;
    const labelColor = dimmed ? COLOR_TEXT_FAINT : skip ? ACCENT_TEAL : undefined;
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrentQueueRow(row) ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button === 1) {
                openMenu(info.x, info.y, rowMenuActions(row));
                return;
            }
            revealQueueRow(row, info);
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 4 },
                    ],
                    gap: 4,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    queueStateRail(stateColor),
                    child &&
                        Container({
                            style: {
                                width: { kind: "px", value: 14 },
                                height: { kind: "grow" },
                            },
                            children: [],
                        }),
                    canExpand
                        ? Container({
                              style: {
                                  direction: "col",
                                  align: "center",
                                  justify: "center",
                                  width: { kind: "px", value: 14 },
                                  height: { kind: "grow" },
                                  hoverBackground: COLOR_BUTTON_HOVER,
                              },
                              onClick: (_rect, info) => {
                                  if (info.button !== 0) return;
                                  if (expanded) collapsedBulkRows.add(row.key);
                                  else collapsedBulkRows.delete(row.key);
                              },
                              children: [
                                  Icon({
                                      name: expanded
                                          ? Icons.chevronDown
                                          : Icons.chevronRight,
                                  }),
                              ],
                          })
                        : !child &&
                          Container({
                              style: {
                                  width: { kind: "px", value: 14 },
                                  height: { kind: "grow" },
                              },
                              children: [],
                          }),
                    Icon({
                        name: op.icon,
                        color: dimmed ? COLOR_TEXT_FAINT : op.color,
                        tooltip: row.op.toUpperCase(),
                        style: {
                            width: { kind: "px", value: 10 },
                            height: { kind: "px", value: 10 },
                        },
                    }),
                    Text({
                        text: row.op.toUpperCase(),
                        color: dimmed ? COLOR_TEXT_FAINT : op.color,
                        style: { width: { kind: "px", value: 42 } },
                    }),
                    Text({
                        text: typeLabel,
                        color: dimmed ? COLOR_TEXT_FAINT : skip ? ACCENT_TEAL : COLOR_TEXT_DIM,
                        style: { width: { kind: "px", value: 46 } },
                    }),
                    Text({
                        text: label,
                        color: labelColor,
                        tooltip: message ?? row.path,
                        tooltipColor: message === null ? COLOR_TEXT_DIM : ACCENT_DANGER,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    message !== null
                        ? Text({
                              text: message,
                              color:
                                  row.status === "failed"
                                      ? ACCENT_DANGER
                                      : COLOR_TEXT_FAINT,
                              tooltip: message,
                              tooltipColor:
                                  row.status === "failed"
                                      ? ACCENT_DANGER
                                      : COLOR_TEXT_DIM,
                              truncate: true,
                              style: { width: { kind: "px", value: 112 } },
                          })
                        : Text({
                              text: shortPath(canonicalPath(row.path)),
                              color: COLOR_TEXT_FAINT,
                              tooltip: row.path,
                              tooltipColor: COLOR_TEXT_DIM,
                              truncate: true,
                              style: { width: { kind: "px", value: 82 } },
                          }),
                    badge !== null &&
                        Icon({
                            name: Icons.arrowLeftRight,
                            color: dimmed
                                ? COLOR_TEXT_FAINT
                                : operationVisual(badge.op).color,
                            tooltip: badge.tooltip,
                            tooltipColor: operationVisual(badge.op).color,
                            style: {
                                width: { kind: "px", value: 10 },
                                height: { kind: "px", value: 10 },
                            },
                        }),
                    statusIcon(row, runState),
                    rowControls(row),
                ],
            }),
            queueRowMiniBar(runState),
        ],
    });
}
