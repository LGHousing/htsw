/// <reference types="../../../CTAutocomplete" />

import {
    clearUserScrollOverride,
    getScrollState,
    isScrollUserOverridden,
    setScrollOffset,
    type Child,
    type Element,
} from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import { markGuiDirty } from "../lib/dirty";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_DIVIDER,
    COLOR_ROW,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../lib/theme";
import {
    getActiveTaskLabel,
    getFinishedTaskFailure,
    getFinishedTaskSummary,
    getSessionVerb,
    getTaskProgress,
    isCurrentQueueItem,
} from "./import-tab/taskProgress";
import { isLiveTabActive } from "./selection";
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
import { queueControl } from "./import-tab/importButtons";
import {
    failedTaskFooterPanel,
    finishedTaskFooterPanel,
    liveTaskFooterPanel,
} from "./import-tab/progressPanel";

let queueExpanded = true;
let queueFollowRequested = false;
let queueFollowEngaged = false;
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
            children: [
                Icon({
                    name: () => (queueFollowRequested ? Icons.locateFixed : Icons.locate),
                    style: {
                        width: { kind: "px", value: 12 },
                        height: { kind: "px", value: 12 },
                    },
                }),
            ],
            tooltip: "Follow the running row — turns off when you scroll",
            style: {
                width: { kind: "px", value: 18 },
                height: { kind: "grow" },
                padding: { side: "x", value: 0 },
                background: () =>
                    queueFollowRequested ? COLOR_ROW_SELECTED : COLOR_BUTTON,
                hoverBackground: () =>
                    queueFollowRequested ? COLOR_ROW_SELECTED_HOVER : COLOR_BUTTON_HOVER,
            },
            onClick: (_rect, info) => {
                if (info.button !== 0) return;
                queueFollowRequested = !queueFollowRequested;
                queueFollowEngaged = false;
                if (queueFollowRequested) clearUserScrollOverride(QUEUE_SCROLL_ID);
                markGuiDirty();
            },
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
            },
        })
    );
    return Row({
        style: {
            gap: 4,
            height: { kind: "px", value: 16 },
            align: "center",
            hoverBackground: COLOR_BUTTON_HOVER,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0 || getQueueLength() === 0) return;
            queueExpanded = !queueExpanded;
        },
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

/**
 * Advance the follow toggle's engagement for this rebuild. A manual scroll
 * only disarms follow after it has actually followed once (engaged) — the
 * user browsing the queue before a run starts must not silently disarm the
 * button they just armed.
 */
function advanceQueueFollow(): boolean {
    if (!queueFollowRequested || getActiveTaskLabel() === null) {
        queueFollowEngaged = false;
        return false;
    }
    if (!queueFollowEngaged) {
        clearUserScrollOverride(QUEUE_SCROLL_ID);
        queueFollowEngaged = true;
    } else if (isScrollUserOverridden(QUEUE_SCROLL_ID)) {
        queueFollowRequested = false;
        queueFollowEngaged = false;
        return false;
    }
    return true;
}

function virtualQueueRows(): Child[] {
    const state = getScrollState(QUEUE_SCROLL_ID);
    const viewportH = state.viewportRect.h > 0 ? state.viewportRect.h : QUEUE_SCROLL_H;
    const groups = queueDisplayGroups();
    const followOn = advanceQueueFollow();
    const activeIdentity = followOn ? getActiveTaskLabel() : null;
    let activeTop = -1;
    let measuredRows = 0;
    let measuredH = 0;

    const measureRows = (count: number, height: number): void => {
        if (count <= 0) return;
        if (measuredRows > 0) measuredH += QUEUE_ROW_GAP;
        measuredH += count * height + (count - 1) * QUEUE_ROW_GAP;
        measuredRows += count;
    };

    const nextRowTop = (): number =>
        measuredRows > 0 ? measuredH + QUEUE_ROW_GAP : measuredH;

    const isActiveImportableRow = (item: QueueItem): boolean =>
        item.kind === "importable" &&
        item.identity === activeIdentity &&
        isCurrentQueueItem(item);

    const measureItems = (items: readonly QueueItem[]): void => {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const expanded =
                item.operation === "import" &&
                item.kind === "importJson" &&
                isQueueImportJsonExpanded(item);
            const rowTop = nextRowTop();
            if (activeTop < 0 && activeIdentity !== null && !expanded) {
                const current =
                    item.kind === "importable"
                        ? isActiveImportableRow(item)
                        : isCurrentQueueItem(item);
                if (current) activeTop = rowTop;
            }
            measureRows(1, SIZE_ROW_H);
            if (!expanded) continue;
            const children = queueImportJsonChildren(item);
            if (children.length === 0) continue;
            if (activeTop < 0 && activeIdentity !== null) {
                const blockTop = nextRowTop();
                for (let j = 0; j < children.length; j++) {
                    if (isActiveImportableRow(children[j])) {
                        activeTop = blockTop + j * (SIZE_ROW_H + QUEUE_ROW_GAP);
                        break;
                    }
                }
                if (activeTop < 0 && isCurrentQueueItem(item)) activeTop = rowTop;
            }
            measureRows(children.length, SIZE_ROW_H);
        }
    };

    measureItems(groups.active);
    if (groups.showDivider) measureRows(1, PENDING_DIVIDER_H);
    measureItems(groups.pending);
    if (measuredRows === 0) return [];

    // Apply follow before the window below reads the offset, so the same
    // rebuild materializes the rows around the followed position.
    if (followOn && activeTop >= 0) {
        const followTarget = Math.max(
            0,
            Math.min(
                Math.max(0, measuredH - viewportH),
                activeTop - (viewportH - SIZE_ROW_H) / 2
            )
        );
        if (Math.abs(state.target - followTarget) > 0.5) {
            setScrollOffset(QUEUE_SCROLL_ID, followTarget);
        }
    }

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
                Math.min(children.length, Math.floor((maxY - blockTop) / stride) + 1)
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
            else if (isLiveTabActive() && getFinishedTaskFailure() !== null) {
                children.push(failedTaskFooterPanel());
            } else if (isLiveTabActive() && getFinishedTaskSummary() !== null) {
                children.push(finishedTaskFooterPanel());
            }
            children.push(queueControl());
            return children;
        },
    });
}
