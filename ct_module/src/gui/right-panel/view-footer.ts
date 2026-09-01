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
    isCurrentQueueRow,
} from "./import-tab/taskProgress";
import { isLiveTabActive } from "./selection";
import {
    clearQueue,
    getQueue,
    getQueueLength,
    getQueueRow,
    groupQueueRowsByHouse,
    queueWorkRowCount,
    type QueueHouseGroup,
    type QueueRow,
} from "./import-tab/queue";
import { isTaskRunning } from "../../tasks/runningState";
import { getHousingUuid } from "../state";
import { houseDisplayName } from "../../importCache/aliases";
import { isQueueBulkExpanded, queueBulkChildren, queueRow } from "./import-tab/queueRows";
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
const HOUSE_DIVIDER_H = 12;

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
                const n = queueWorkRowCount(getQueue());
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

/** Top-level rows of a house group: bulk children render under their parent. */
function topLevelRows(rows: readonly QueueRow[]): QueueRow[] {
    const out: QueueRow[] = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.parentKey !== null && getQueueRow(row.parentKey) !== null) continue;
        out.push(row);
    }
    return out;
}

function expandedChildren(row: QueueRow): QueueRow[] {
    return isQueueBulkExpanded(row) ? queueBulkChildren(row) : [];
}

function houseDividerLabel(group: QueueHouseGroup): string {
    const alias = group.house === null ? "another house" : houseDisplayName(group.house);
    return `In ${alias} (${queueWorkRowCount(group.rows)})`;
}

function virtualQueueRows(): Child[] {
    const state = getScrollState(QUEUE_SCROLL_ID);
    const viewportH = state.viewportRect.h > 0 ? state.viewportRect.h : QUEUE_SCROLL_H;
    const groups = groupQueueRowsByHouse(getQueue(), getHousingUuid());
    const followOn = advanceQueueFollow();
    const following = followOn && getActiveTaskLabel() !== null;
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

    const measureGroup = (group: QueueHouseGroup): void => {
        if (!group.current) measureRows(1, HOUSE_DIVIDER_H);
        const rows = topLevelRows(group.rows);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const children = expandedChildren(row);
            const rowTop = nextRowTop();
            if (activeTop < 0 && following && children.length === 0) {
                if (isCurrentQueueRow(row)) activeTop = rowTop;
            }
            measureRows(1, SIZE_ROW_H);
            if (children.length === 0) continue;
            if (activeTop < 0 && following) {
                const blockTop = nextRowTop();
                for (let j = 0; j < children.length; j++) {
                    if (isCurrentQueueRow(children[j])) {
                        activeTop = blockTop + j * (SIZE_ROW_H + QUEUE_ROW_GAP);
                        break;
                    }
                }
                if (activeTop < 0 && isCurrentQueueRow(row)) activeTop = rowTop;
            }
            measureRows(children.length, SIZE_ROW_H);
        }
    };

    for (let g = 0; g < groups.length; g++) measureGroup(groups[g]);
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

    const append = (height: number, build: () => Element): void => {
        if (rowCount > 0) contentH += QUEUE_ROW_GAP;
        const top = contentH;
        const bottom = top + height;
        if (bottom >= minY && top <= maxY) {
            if (firstVisibleY < 0) firstVisibleY = top;
            visible.push(build());
            lastVisibleBottom = bottom;
        }
        contentH = bottom;
        rowCount++;
    };

    const appendGroup = (group: QueueHouseGroup): void => {
        if (!group.current) {
            append(HOUSE_DIVIDER_H, () => houseDividerRow(houseDividerLabel(group)));
        }
        const dimmed = !group.current;
        const rows = topLevelRows(group.rows);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            append(SIZE_ROW_H, () => queueRow(row, { dimmed }));
            const children = expandedChildren(row);
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
                visible.push(queueRow(children[j], { child: true, dimmed }));
                lastVisibleBottom = top + SIZE_ROW_H;
            }
            contentH =
                blockTop +
                children.length * SIZE_ROW_H +
                (children.length - 1) * QUEUE_ROW_GAP;
            rowCount += children.length;
        }
    };

    for (let g = 0; g < groups.length; g++) appendGroup(groups[g]);
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

/** Rows for a house other than the current one wait until you visit it. */
function houseDividerRow(label: string): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 6 },
            height: { kind: "px", value: HOUSE_DIVIDER_H },
            background: COLOR_ROW,
        },
        children: [
            Text({
                text: label,
                color: COLOR_TEXT_FAINT,
                tooltip: "Runs when you are in that house",
                tooltipColor: COLOR_TEXT_FAINT,
                truncate: true,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

/** "N more in <alias>" for rows that wait on another house. */
function otherHouseNote(): Element | null {
    const groups = groupQueueRowsByHouse(getQueue(), getHousingUuid());
    const parts: string[] = [];
    for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        if (group.current || group.house === null) continue;
        parts.push(`${queueWorkRowCount(group.rows)} more in ${houseDisplayName(group.house)}`);
    }
    if (parts.length === 0) return null;
    return Text({
        text: parts.join(" · "),
        color: COLOR_TEXT_FAINT,
        tooltip: "Those rows run when you are in that house",
        tooltipColor: COLOR_TEXT_FAINT,
        truncate: true,
        style: { width: { kind: "grow" } },
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
            const note = otherHouseNote();
            if (note !== null) children.push(note);
            children.push(queueControl());
            return children;
        },
    });
}
