/// <reference types="../../../../CTAutocomplete" />

/**
 * Queue rows for the import tab: the visible list of items waiting to be
 * imported, with expand/collapse for import.json bundles and per-row mini
 * progress bars driven by the live import session.
 */

import type { Importable } from "htsw/types";

import type { Element } from "../../lib/layout";
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
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
    SIZE_ROW_H,
} from "../../lib/theme";

import { getHousingUuid, isCurrentHouseTrusted, isImportableChecked, toggleImportableChecked } from "../../state";
import { getQueueItemRunState, isCurrentQueueItem } from "./importProgress";
import { importableIdentity, importableKey } from "../../../importCache/paths";
import { buildCacheStatusRow } from "../../../importCache/status";
import {
    isQueueSessionItem,
    queueItemKey,
    removeFromQueueKey,
    type QueueItem,
} from "./queue";
import { requestParse } from "../../parsing/parses";
import { orderImportablesForImportSession } from "../../../importables/importSession";
import { isImportRunning } from "../../../housingSync/runtimeState";
import { phaseSegment } from "./progressPanel";

function willBeSkipped(item: QueueItem): boolean {
    if (!isCurrentHouseTrusted()) return false;
    if (item.operation !== "import" || item.kind !== "importable") return false;
    const uuid = getHousingUuid();
    if (uuid === null) return false;
    const cached = requestParse(item.sourcePath);
    const parsed = cached?.parsed ?? null;
    if (parsed === null) return false;
    const imp = findImportableInList(parsed.value, item.identity, item.type);
    if (imp === null) return false;
    return buildCacheStatusRow(uuid, imp).state === "current";
}

function findImportableInList(
    list: readonly Importable[],
    identity: string,
    type: Importable["type"]
): Importable | null {
    for (let i = 0; i < list.length; i++) {
        if (list[i].type === type && importableIdentity(list[i]) === identity) return list[i];
    }
    return null;
}

const collapsedQueueImportJsonRows: Set<string> = new Set();

/**
 * Remove a queue item and, for a single importable, also clear its
 * Importables-tab checkbox so the two stay in sync (the Importables row's
 * checkbox both adds to the queue and marks itself checked, so removal
 * has to undo both). importJson bundles have no single checkbox.
 */
function removeQueueItemAndUncheck(item: QueueItem): void {
    removeFromQueueKey(queueItemKey(item));
    if (item.operation !== "import" || item.kind !== "importable") return;
    const checkKey = importableKey(item.type, item.identity);
    if (isImportableChecked(checkKey)) toggleImportableChecked(checkKey);
}

function queueRowMiniBar(item: QueueItem): Element {
    const state = getQueueItemRunState(item);
    if (state.kind === "queued" || state.kind === "parked") {
        // Empty 2px slot — keeps row heights uniform. "parked" rows finished
        // pass-1 hydration but pass-2 hasn't reached them; leave the bar blank
        // (a fill there reads as "in progress" when it's just waiting).
        return Container({
            style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
            children: [],
        });
    }
    if (state.kind === "done") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_SUCCESS,
            },
            children: [],
        });
    }
    if (state.kind === "skipped") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_TEAL,
            },
            children: [],
        });
    }
    if (state.kind === "failed") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_DANGER,
            },
            children: [],
        });
    }
    const color = phaseColor(state.phase);
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 2 },
        },
        children: [phaseSegment(1, state.phaseFraction, color)],
    });
}

function phaseColor(phase: "reading" | "hydrating" | "applying"): number {
    if (phase === "applying") return PHASE_APPLYING;
    if (phase === "hydrating") return PHASE_HYDRATING;
    return PHASE_READING;
}

function isActiveQueueItem(item: QueueItem): boolean {
    return getQueueItemRunState(item).kind === "current";
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

function queueImportableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

export function queueImportJsonChildren(item: QueueItem): QueueItem[] {
    if (item.operation !== "import" || item.kind !== "importJson") return [];
    const cached = requestParse(item.sourcePath);
    if (cached === null || cached.parsed === null) return [];
    const ordered = orderImportablesForImportSession(
        cached.parsed.value,
        cached.parsed.value
    );
    return ordered.map((imp) => ({
        operation: "import",
        kind: "importable",
        sourcePath: item.sourcePath,
        identity: importableIdentity(imp),
        type: imp.type,
        label: queueImportableLabel(imp),
    }));
}

export function isQueueImportJsonExpanded(item: QueueItem): boolean {
    return item.operation === "import" && item.kind === "importJson" && !collapsedQueueImportJsonRows.has(queueItemKey(item));
}

export function queueRow(item: QueueItem): Element {
    const typeText = item.kind === "importJson" ? "ALL" : item.type;
    const isCurrent = isCurrentQueueItem(item);
    const isActive = isActiveQueueItem(item);
    const skip = willBeSkipped(item);
    const canExpand = item.operation === "import" && item.kind === "importJson";
    const expanded = canExpand && isQueueImportJsonExpanded(item);
    const stateColor = isActive ? PHASE_READING : skip ? ACCENT_TEAL : undefined;
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    queueStateRail(stateColor),
                    canExpand && Container({
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
                            const key = queueItemKey(item);
                            if (expanded) collapsedQueueImportJsonRows.add(key);
                            else collapsedQueueImportJsonRows.delete(key);
                        },
                        children: [Icon({ name: expanded ? Icons.chevronDown : Icons.chevronRight })],
                    }),
                    Text({
                        text: typeText,
                        color: skip ? ACCENT_TEAL : COLOR_TEXT_DIM,
                        tooltip: skip ? "Trusted - will skip" : undefined,
                        tooltipColor: ACCENT_TEAL,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        color: skip ? ACCENT_TEAL : undefined,
                        tooltip: skip ? "Trusted - will skip" : undefined,
                        tooltipColor: ACCENT_TEAL,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    // No removal while an import is running — the queue is
                    // locked for the duration of the run.
                    isImportRunning() || isQueueSessionItem(queueItemKey(item))
                        ? Container({
                              style: { width: { kind: "px", value: 14 }, height: { kind: "grow" } },
                              children: [],
                          })
                        : Container({
                              style: {
                                  direction: "col",
                                  width: { kind: "px", value: 14 },
                                  height: { kind: "grow" },
                                  align: "center",
                                  justify: "center",
                                  hoverBackground: 0x40e85c5c | 0,
                              },
                              onClick: (_rect, info) => {
                                  if (info.button !== 0) return;
                                  removeQueueItemAndUncheck(item);
                              },
                              children: [Icon({ name: Icons.x })],
                          }),
                ],
            }),
            queueRowMiniBar(item),
        ],
    });
}

export function queueImportJsonChildRow(item: QueueItem): Element {
    const isCurrent = isCurrentQueueItem(item);
    const isActive = isActiveQueueItem(item);
    const skip = willBeSkipped(item);
    const stateColor = isActive ? PHASE_READING : skip ? ACCENT_TEAL : undefined;
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    queueStateRail(stateColor),
                    Text({
                        text: item.kind === "importable" ? item.type : "ALL",
                        color: skip ? ACCENT_TEAL : COLOR_TEXT_DIM,
                        tooltip: skip ? "Trusted - will skip" : undefined,
                        tooltipColor: ACCENT_TEAL,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        color: skip ? ACCENT_TEAL : undefined,
                        tooltip: skip ? "Trusted - will skip" : undefined,
                        tooltipColor: ACCENT_TEAL,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    Container({
                        style: { width: { kind: "px", value: 14 }, height: { kind: "grow" } },
                        children: [],
                    }),
                ],
            }),
            queueRowMiniBar(item),
        ],
    });
}
