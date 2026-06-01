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
    COLOR_ROW,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";
import {
    getHousingUuid,
    getImportProgress,
    isCurrentHouseTrusted,
    isImportSoundsMuted,
    setHouseTrust,
    setImportSoundsMuted,
} from "../../state";
import { queueDisplayGroups, type QueueItem } from "../../state/queue";
import { getAlias } from "../../../importCache/aliases";
import { openAliasPopover } from "../../popovers/alias";
import {
    getStepAuto,
    requestStepAdvance,
    setStepAuto,
} from "../../../importer/stepGate";
import { liveImporterPanel } from "./progress";
import {
    isQueueImportJsonExpanded,
    queueHeader,
    queueImportJsonChildren,
    queueImportJsonChildRow,
    queueRow,
} from "./queue";
import { importActionRow } from "./actions-ui";
import { livePreviewBody } from "./live-preview-body";

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
            // Alias-or-UUID + faint UUID tail. Width is `grow` so a long alias
            // can't push the right-aligned toggles off the row — the toggles
            // keep their fixed widths and this text gets the rest. The Trust
            // button paints AFTER this text, so visual overflow gets masked.
            Text({
                style: { width: { kind: "grow" } },
                text: () => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return "(unknown — open Knowledge tab to detect)";
                    const alias = getAlias(uuid);
                    if (alias === null) return shortUuid(uuid);
                    return `${alias} §8${shortUuid(uuid)}`;
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

function pauseControlRow(): Element {
    return Row({
        style: { gap: 2, height: { kind: "px", value: SIZE_ROW_H } },
        children: () => {
            const auto = getStepAuto();
            const importing = getImportProgress() !== null;
            if (!importing) {
                return [
                    Button({
                        text: auto ? "Auto-proceed: On" : "Auto-proceed: Off",
                        style: {
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => setStepAuto(!getStepAuto()),
                    }),
                ];
            }
            const children: Element[] = [
                Button({
                    text: auto ? "Pause" : "Resume",
                    style: {
                        width: { kind: "px", value: 72 },
                        height: { kind: "grow" },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    onClick: () => setStepAuto(!getStepAuto()),
                }),
            ];
            if (!auto) {
                children.push(Button({
                    text: "Step Once",
                    style: {
                        width: { kind: "px", value: 72 },
                        height: { kind: "grow" },
                        background: COLOR_BUTTON,
                        hoverBackground: COLOR_BUTTON_HOVER,
                    },
                    onClick: () => requestStepAdvance(),
                }));
            }
            return children;
        },
    });
}

function appendQueueRows(rows: Child[], items: readonly QueueItem[]): void {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        rows.push(queueRow(item));
        if (item.kind === "importJson" && isQueueImportJsonExpanded(item)) {
            const children = queueImportJsonChildren(item);
            for (let j = 0; j < children.length; j++) {
                rows.push(queueImportJsonChildRow(item, children[j]));
            }
        }
    }
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

export function importTab(): Element {
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            houseHeader(),
            queueHeader(),
            Scroll({
                id: "right-import-queue-scroll",
                style: { gap: 2, height: { kind: "px", value: 120 } },
                children: () => {
                    const groups = queueDisplayGroups();
                    if (groups.active.length === 0 && groups.pending.length === 0) {
                        return [
                            Container({
                                style: { padding: 6 },
                                children: [
                                    Text({
                                        text: "Queue is empty — right-click anything in Explore and Add to queue.",
                                        color: COLOR_TEXT_FAINT,
                                    }),
                                ],
                            }),
                        ];
                    }
                    const rows: Child[] = [];
                    appendQueueRows(rows, groups.active);
                    if (groups.showDivider) {
                        rows.push(pendingDividerRow());
                    }
                    appendQueueRows(rows, groups.pending);
                    return rows;
                },
            }),
            liveImporterPanel(),
            livePreviewBody(),
            pauseControlRow(),
            importActionRow(),
        ],
    });
}
