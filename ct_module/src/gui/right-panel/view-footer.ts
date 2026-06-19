/// <reference types="../../../CTAutocomplete" />

import type { Child, Element } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_DIVIDER,
    COLOR_ROW,
    COLOR_TEXT,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import { clearImportableChecks } from "../state";
import { getActiveImportLabel, getImportProgress } from "./import-tab/importProgress";
import {
    clearQueue,
    getQueueLength,
    queueDisplayGroups,
    type QueueItem,
} from "./import-tab/queue";
import { isImportRunning } from "../../housingSync/runtimeState";
import {
    isQueueImportJsonExpanded,
    queueImportJsonChildren,
    queueImportJsonChildRow,
    queueRow,
} from "./import-tab/queueRows";
import { importControl } from "./import-tab/importButtons";
import { liveImporterFooterPanel } from "./import-tab/progressPanel";

let queueExpanded = true;

function isQueueExpanded(): boolean {
    return queueExpanded && getQueueLength() > 0;
}

function appendQueueRows(rows: Child[], items: readonly QueueItem[]): void {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        rows.push(queueRow(item));
        if (item.operation === "import" && item.kind === "importJson" && isQueueImportJsonExpanded(item)) {
            const children = queueImportJsonChildren(item);
            for (let j = 0; j < children.length; j++) {
                rows.push(queueImportJsonChildRow(children[j]));
            }
        }
    }
}

export function queueSummary(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 16 }, align: "center" },
        children: [
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
                    if (info.button !== 0) return;
                    if (getQueueLength() === 0) return;
                    queueExpanded = !queueExpanded;
                },
                children: [
                    Icon({ name: () => (isQueueExpanded() ? Icons.chevronDown : Icons.chevronRight) }),
                ],
            }),
            Text({
                text: () => {
                    const active = getActiveImportLabel();
                    if (active !== null) return `Queue (${getQueueLength()}) · Now: ${active}`;
                    const n = getQueueLength();
                    return n === 0 ? "Queue (empty)" : `Queue (${n})`;
                },
                color: COLOR_TEXT,
                truncate: true,
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
                onClick: () => {
                    if (isImportRunning()) return;
                    clearQueue();
                    clearImportableChecks();
                },
            }),
        ],
    });
}

export function queueScroll(): Element {
    return Scroll({
        id: "right-import-queue-scroll",
        style: { gap: 2, height: { kind: "px", value: 120 } },
        children: () => {
            const groups = queueDisplayGroups();
            const rows: Child[] = [];
            appendQueueRows(rows, groups.active);
            if (groups.showDivider) {
                rows.push(pendingDividerRow());
            }
            appendQueueRows(rows, groups.pending);
            return rows;
        },
    });
}

function pendingDividerRow(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 6 },
            height: { kind: "px", value: 12 },
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
            const children: Child[] = [divider(), queueSummary()];
            if (isQueueExpanded()) children.push(queueScroll());
            if (getImportProgress() !== null) children.push(liveImporterFooterPanel());
            children.push(importControl());
            return children;
        },
    });
}
