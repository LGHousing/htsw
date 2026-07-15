/// <reference types="../../../CTAutocomplete" />

import { getScrollState, type Child, type Element } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_DIVIDER,
    COLOR_ROW,
    COLOR_TEXT,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../lib/theme";
import { clearImportableChecks } from "../state";
import {
    getActiveTaskLabel,
    getSessionVerb,
    getTaskProgress,
} from "./import-tab/taskProgress";
import {
    clearQueue,
    getQueueLength,
    queueDisplayGroups,
    type QueueItem,
} from "./import-tab/queue";
import { isTaskRunning } from "../../tasks/runningState";
import {
    isQueueImportJsonExpanded,
    queueImportJsonChildren,
    queueImportJsonChildRow,
    queueRow,
} from "./import-tab/queueRows";
import { importControl } from "./import-tab/importButtons";
import { liveTaskFooterPanel } from "./import-tab/progressPanel";

let queueExpanded = true;
const QUEUE_SCROLL_ID = "right-import-queue-scroll";
const QUEUE_SCROLL_H = 120;
const QUEUE_ROW_GAP = 2;
const QUEUE_OVERSCAN_PX = 60;
const PENDING_DIVIDER_H = 12;

function isQueueExpanded(): boolean {
    return queueExpanded && getQueueLength() > 0;
}

function queueSummary(): Element {
    const children: Child[] = [];
    // Nothing to expand when the queue is empty, so drop the caret entirely
    // (its row width goes too, letting the label sit flush-left).
    if (getQueueLength() > 0) children.push(queueChevron());
    children.push(
        Text({
            text: () => {
                const active = getActiveTaskLabel();
                const n = getQueueLength();
                if (active !== null) return `Queue (${n}) · Now: ${active}`;
                return n === 0 ? "Queue (empty)" : `Queue (${n})`;
            },
            color: COLOR_TEXT,
            truncate: true,
            style: { width: { kind: "grow" } },
        }),
        Button({
            text: "Clear",
            disabled: () => isTaskRunning() || getQueueLength() === 0,
            style: {
                width: { kind: "px", value: 38 },
                height: { kind: "grow" },
                background: COLOR_BUTTON,
                hoverBackground: COLOR_BUTTON_HOVER,
            },
            onClick: () => {
                clearQueue();
                clearImportableChecks();
            },
        })
    );
    return Row({
        style: { gap: 4, height: { kind: "px", value: 16 }, align: "center" },
        children,
    });
}

function queueChevron(): Element {
    return Container({
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
            queueExpanded = !queueExpanded;
        },
        children: [
            Icon({
                name: () => (isQueueExpanded() ? Icons.chevronDown : Icons.chevronRight),
            }),
        ],
    });
}

function queueScroll(): Element {
    return Scroll({
        id: QUEUE_SCROLL_ID,
        style: { gap: QUEUE_ROW_GAP, height: { kind: "px", value: QUEUE_SCROLL_H } },
        children: virtualQueueRows,
    });
}

function virtualQueueRows(): Child[] {
    const state = getScrollState(QUEUE_SCROLL_ID);
    const viewportH = state.viewportRect.h > 0 ? state.viewportRect.h : QUEUE_SCROLL_H;
    const groups = queueDisplayGroups();
    let measuredRows = 0;
    let measuredH = 0;

    const measureRows = (count: number, height: number): void => {
        if (count <= 0) return;
        if (measuredRows > 0) measuredH += QUEUE_ROW_GAP;
        measuredH += count * height + (count - 1) * QUEUE_ROW_GAP;
        measuredRows += count;
    };

    const measureItems = (items: readonly QueueItem[]): void => {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            measureRows(1, SIZE_ROW_H);
            if (
                item.operation === "import" &&
                item.kind === "importJson" &&
                isQueueImportJsonExpanded(item)
            ) {
                measureRows(queueImportJsonChildren(item).length, SIZE_ROW_H);
            }
        }
    };

    measureItems(groups.active);
    if (groups.showDivider) measureRows(1, PENDING_DIVIDER_H);
    measureItems(groups.pending);
    if (measuredRows === 0) return [];

    const offset = Math.max(
        0,
        Math.min(state.offset, Math.max(0, measuredH - viewportH))
    );
    const minY = Math.max(0, offset - QUEUE_OVERSCAN_PX);
    const maxY = offset + viewportH + QUEUE_OVERSCAN_PX;
    const visible: Element[] = [];
    let rowCount = 0;
    let contentH = 0;
    let firstVisibleY = -1;
    let lastVisibleBottom = -1;

    const append = (height: number, item: QueueItem | null): void => {
        if (rowCount > 0) contentH += QUEUE_ROW_GAP;
        const top = contentH;
        const bottom = top + height;
        if (bottom >= minY && top <= maxY) {
            if (firstVisibleY < 0) firstVisibleY = top;
            if (item === null) visible.push(pendingDividerRow());
            else visible.push(queueRow(item));
            lastVisibleBottom = bottom;
        }
        contentH = bottom;
        rowCount++;
    };

    const appendItems = (items: readonly QueueItem[]): void => {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            append(SIZE_ROW_H, item);
            if (
                item.operation !== "import" ||
                item.kind !== "importJson" ||
                !isQueueImportJsonExpanded(item)
            ) {
                continue;
            }
            const children = queueImportJsonChildren(item);
            if (children.length === 0) continue;
            if (rowCount > 0) contentH += QUEUE_ROW_GAP;
            const blockTop = contentH;
            const stride = SIZE_ROW_H + QUEUE_ROW_GAP;
            const first = Math.max(
                0,
                Math.min(
                    children.length,
                    Math.ceil((minY - blockTop - SIZE_ROW_H) / stride)
                )
            );
            const last = Math.max(
                first,
                Math.min(
                    children.length,
                    Math.floor((maxY - blockTop) / stride) + 1
                )
            );
            for (let j = first; j < last; j++) {
                const top = blockTop + j * stride;
                if (firstVisibleY < 0) firstVisibleY = top;
                visible.push(queueImportJsonChildRow(children[j]));
                lastVisibleBottom = top + SIZE_ROW_H;
            }
            contentH =
                blockTop +
                children.length * SIZE_ROW_H +
                (children.length - 1) * QUEUE_ROW_GAP;
            rowCount += children.length;
        }
    };

    appendItems(groups.active);
    if (groups.showDivider) append(PENDING_DIVIDER_H, null);
    appendItems(groups.pending);
    if (visible.length === 0) return [queueSpacer(contentH)];

    const rows: Child[] = [];
    if (firstVisibleY > 0) {
        rows.push(queueSpacer(firstVisibleY - QUEUE_ROW_GAP));
    }
    for (let i = 0; i < visible.length; i++) rows.push(visible[i]);
    if (lastVisibleBottom < contentH) {
        rows.push(queueSpacer(contentH - lastVisibleBottom - QUEUE_ROW_GAP));
    }
    return rows;
}

function queueSpacer(height: number): Element {
    return Container({
        style: { width: { kind: "grow" }, height: { kind: "px", value: height } },
        children: [],
    });
}

function pendingDividerRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 6 },
            height: { kind: "px", value: PENDING_DIVIDER_H },
            background: COLOR_ROW,
        },
        children: [
            Text({
                text: "Pending — added during import, runs next",
                color: COLOR_TEXT_FAINT,
            }),
        ],
    });
}

function divider(): Element {
    return Container({
        style: { height: { kind: "px", value: 1 }, background: COLOR_DIVIDER },
        children: [],
    });
}

export function viewFooter(): Element {
    return Col({
        style: { gap: 4, width: { kind: "grow" } },
        children: () => {
            const taskListIsInView =
                getTaskProgress() !== null && getSessionVerb() !== "import";
            const children: Child[] = [divider()];
            if (!taskListIsInView) {
                children.push(queueSummary());
                if (isQueueExpanded()) children.push(queueScroll());
            }
            if (getTaskProgress() !== null) children.push(liveTaskFooterPanel());
            children.push(importControl());
            return children;
        },
    });
}
