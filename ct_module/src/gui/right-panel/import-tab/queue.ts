/// <reference types="../../../../CTAutocomplete" />

/**
 * Queue rows for the import tab: the visible list of items waiting to be
 * imported, with expand/collapse for import.json bundles and per-row mini
 * progress bars driven by the live import session.
 */

import type { Importable } from "htsw/types";

import type { Element } from "../../lib/layout";
import { Button, Container, Icon, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
    SIZE_ROW_H,
} from "../../lib/theme";
import { getQueueItemRunState, isCurrentQueueItem } from "../../state";
import {
    clearQueue,
    getQueueLength,
    queueItemKey,
    removeFromQueueKey,
    type QueueItem,
} from "../../state/queue";
import { parseImportJsonAt } from "../../state/parses";
import { importableIdentity } from "../../../importCache/paths";
import { orderImportablesForImportSession } from "../../../importables/importSession";
import { phaseSegment } from "./progress";

const collapsedQueueImportJsonRows: Set<string> = new Set();

function shortSource(p: string): string {
    const norm = p.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function queueRowMiniBar(item: QueueItem): Element {
    const state = getQueueItemRunState(item);
    if (state.kind === "queued") {
        // Empty 2px slot — keeps row heights uniform.
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
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 2 },
        },
        children: [
            phaseSegment(state.readWidth, state.readFraction, PHASE_READING),
            phaseSegment(state.hydrateWidth, state.hydrateFraction, PHASE_HYDRATING),
            phaseSegment(state.applyWidth, state.applyFraction, PHASE_APPLYING),
        ],
    });
}

function queueImportableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

export function queueImportJsonChildren(item: QueueItem): QueueItem[] {
    if (item.kind !== "importJson") return [];
    const cached = parseImportJsonAt(item.sourcePath);
    if (cached.parsed === null) return [];
    const ordered = orderImportablesForImportSession(
        cached.parsed.value,
        cached.parsed.value
    );
    return ordered.map((imp) => ({
        kind: "importable",
        sourcePath: item.sourcePath,
        identity: importableIdentity(imp),
        type: imp.type,
        label: queueImportableLabel(imp),
    }));
}

export function isQueueImportJsonExpanded(item: QueueItem): boolean {
    return item.kind === "importJson" && !collapsedQueueImportJsonRows.has(queueItemKey(item));
}

export function queueRow(item: QueueItem): Element {
    const typeText = item.kind === "importJson" ? "ALL" : item.type;
    const isCurrent = isCurrentQueueItem(item);
    const canExpand = item.kind === "importJson";
    const expanded = canExpand && isQueueImportJsonExpanded(item);
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
                    // Left-edge stripe — green for the importable currently being
                    // processed, otherwise an invisible 2px spacer.
                    Container({
                        style: {
                            width: { kind: "px", value: 2 },
                            height: { kind: "grow" },
                            background: isCurrent ? ACCENT_SUCCESS : undefined,
                        },
                        children: [],
                    }),
                    Container({
                        style: {
                            direction: "col",
                            align: "center",
                            justify: "center",
                            width: { kind: "px", value: 14 },
                            height: { kind: "grow" },
                            hoverBackground: canExpand ? COLOR_BUTTON_HOVER : undefined,
                        },
                        onClick: (_rect, info) => {
                            if (!canExpand || info.button !== 0) return;
                            const key = queueItemKey(item);
                            if (expanded) collapsedQueueImportJsonRows.add(key);
                            else collapsedQueueImportJsonRows.delete(key);
                        },
                        children: canExpand
                            ? [Icon({ name: expanded ? Icons.chevronDown : Icons.chevronRight })]
                            : [],
                    }),
                    Text({
                        text: typeText,
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        style: { width: { kind: "grow" } },
                    }),
                    Text({
                        text: shortSource(item.sourcePath),
                        color: COLOR_TEXT_FAINT,
                    }),
                    Container({
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
                            removeFromQueueKey(queueItemKey(item));
                        },
                        children: [Icon({ name: Icons.x })],
                    }),
                ],
            }),
            queueRowMiniBar(item),
        ],
    });
}

export function queueImportJsonChildRow(parent: QueueItem, item: QueueItem): Element {
    const isCurrent = isCurrentQueueItem(item);
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
                    Container({
                        style: {
                            width: { kind: "px", value: 2 },
                            height: { kind: "grow" },
                            background: isCurrent ? ACCENT_SUCCESS : undefined,
                        },
                        children: [],
                    }),
                    Container({
                        style: { width: { kind: "px", value: 14 }, height: { kind: "grow" } },
                        children: [],
                    }),
                    Text({
                        text: item.kind === "importable" ? item.type : "ALL",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        style: { width: { kind: "grow" } },
                    }),
                    Text({
                        text: shortSource(parent.sourcePath),
                        color: COLOR_TEXT_FAINT,
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

export function queueHeader(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 16 }, align: "center" },
        children: [
            Text({
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Queue (empty)" : `Queue (${n})`;
                },
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
            Button({
                text: "Clear",
                style: {
                    width: { kind: "px", value: 38 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => clearQueue(),
            }),
        ],
    });
}
