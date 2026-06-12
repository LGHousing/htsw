/// <reference types="../../../../CTAutocomplete" />

/**
 * Composition of the Import tab: house header (alias + trust toggle +
 * sound mute), queue rows, live importer panel, live preview body, pause
 * controls, and the bottom action row.
 */

import type { Child, Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_DIVIDER,
    COLOR_ROW,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import {
    clearImportableChecks,
    getHousingUuid,
    isCurrentHouseTrusted,
    isImportSoundsMuted,
    setHouseTrust,
    setImportSoundsMuted,
} from "../../state";
import { getActiveImportLabel, getImportProgress } from "./importProgress";
import {
    clearQueue,
    getQueueLength,
    queueDisplayGroups,
    type QueueItem,
} from "./queue";
import { isImportRunning } from "../../../housingSync/runtimeState";
import { getAlias } from "../../../importCache/aliases";
import { openAliasPopover } from "../../popovers/alias";
import { liveImporterPanel } from "./progressPanel";
import {
    isQueueImportJsonExpanded,
    queueImportJsonChildren,
    queueImportJsonChildRow,
    queueRow,
} from "./queueRows";
import { importActionRow } from "./importButtons";
import { livePreviewBody } from "./live-preview-body";

// Starts open — a fresh session showing a populated-but-collapsed queue
// read as a bug. Collapsing is remembered for the session.
let queueExpanded = true;

// An empty queue can't be expanded — there's nothing to show, so the
// 120px scroll area would just be dead space. The chevron then reads as
// collapsed until something is queued.
function isQueueExpanded(): boolean {
    return queueExpanded && getQueueLength() > 0;
}

const TRUST_ON_BG = 0xff1e3d3d | 0;
const TRUST_ON_HOVER = 0xff2a4f4f | 0;
const TRUST_OFF_BG = 0xff2d333d | 0;
const TRUST_OFF_HOVER = 0xff3a4350 | 0;

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}

function houseHeader(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "left", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: COLOR_ROW,
        },
        children: [
            Text({ text: "House:", color: COLOR_TEXT_DIM }),
            // Alias when set, else the shortened UUID. Width is `grow` so a long
            // alias can't push the right-aligned toggles off the row — the
            // toggles keep their fixed widths and this text gets the rest. The
            // Trust button paints AFTER this text, so visual overflow gets masked.
            Text({
                style: { width: { kind: "grow" } },
                text: () => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return "(unknown — open Houses tab to detect)";
                    return getAlias(uuid) ?? shortUuid(uuid);
                },
                color: COLOR_TEXT,
            }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 4,
                    width: { kind: "px", value: 70 },
                    height: { kind: "grow" },
                    background: () => (isCurrentHouseTrusted() ? TRUST_ON_BG : TRUST_OFF_BG),
                    hoverBackground: () =>
                        isCurrentHouseTrusted() ? TRUST_ON_HOVER : TRUST_OFF_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    const uuid = getHousingUuid();
                    if (uuid === null) return;
                    setHouseTrust(uuid, !isCurrentHouseTrusted());
                },
                children: [
                    Icon({
                        name: () =>
                            isCurrentHouseTrusted() ? Icons.shieldCheck : Icons.shield,
                    }),
                    Text({
                        text: "Trust",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
            Container({
                style: {
                    direction: "col",
                    align: "center",
                    justify: "center",
                    width: { kind: "px", value: 18 },
                    height: { kind: "grow" },
                    background: () => (isImportSoundsMuted() ? TRUST_ON_BG : COLOR_BUTTON),
                    hoverBackground: () =>
                        isImportSoundsMuted() ? TRUST_ON_HOVER : COLOR_BUTTON_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    setImportSoundsMuted(!isImportSoundsMuted());
                },
                children: [
                    Icon({
                        name: () =>
                            isImportSoundsMuted() ? Icons.volumeOff : Icons.volume2,
                    }),
                ],
            }),
            Button({
                icon: Icons.pencil,
                text: "Alias",
                style: {
                    width: { kind: "px", value: 56 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect: Rect) => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return;
                    openAliasPopover(rect, uuid);
                },
            }),
        ],
    });
}

function appendQueueRows(rows: Child[], items: readonly QueueItem[]): void {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        rows.push(queueRow(item));
        if (item.kind === "importJson" && isQueueImportJsonExpanded(item)) {
            const children = queueImportJsonChildren(item);
            for (let j = 0; j < children.length; j++) {
                rows.push(queueImportJsonChildRow(children[j]));
            }
        }
    }
}

function queueSummary(): Element {
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
                    if (active !== null) return `Now: ${active}`;
                    const n = getQueueLength();
                    return n === 0 ? "Queue (empty)" : `Queue (${n})`;
                },
                color: COLOR_TEXT,
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

function queueScroll(): Element {
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

export function importTab(): Element {
    const importing = getImportProgress() !== null;
    const children: Child[] = [houseHeader(), queueSummary()];
    if (isQueueExpanded()) children.push(queueScroll());
    // Hairline between the queue section and the live-preview body — without
    // it the two read as one mushy block.
    children.push(divider());
    children.push(livePreviewBody());
    // The live progress strip sits just above the action row while a run is active.
    if (importing) children.push(liveImporterPanel());
    children.push(importActionRow());
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children,
    });
}
