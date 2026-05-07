/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    getHousingUuid,
    getKnowledgeRows,
    isHouseTrusted,
    setHousingUuid,
    setHouseTrust,
} from "../../state";
import { STATUS_COLOR, STATUS_LABEL } from "../../knowledge-status";
import { GLYPH_DOT } from "../../lib/theme";
import { getCurrentHousingUuid } from "../../../knowledge/housingId";
import { getAlias, listAliases } from "../../../knowledge/aliases";
import { openAliasPopover } from "../../popovers/alias";
import { TaskManager } from "../../../tasks/manager";
import { KNOWLEDGE_ROOT } from "../../../knowledge/paths";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
} from "../../lib/theme";

const TRUST_ON_BG = 0xff2d4d2d | 0;
const TRUST_ON_HOVER = 0xff3a5d3a | 0;
const TRUST_OFF_BG = 0xff2d333d | 0;
const TRUST_OFF_HOVER = 0xff3a4350 | 0;

function detectHousing(): void {
    TaskManager.run(async (ctx) => {
        try {
            const uuid = await getCurrentHousingUuid(ctx);
            setHousingUuid(uuid);
            ChatLib.chat(`&a[htsw] Housing UUID: ${uuid}`);
        } catch (err) {
            ChatLib.chat(`&c[htsw] Detect failed: ${err}`);
        }
    }).catch((err: unknown) => {
        ChatLib.chat(`&c[htsw] Detect task failed: ${err}`);
    });
}

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}

/** Enumerate every UUID dir under the knowledge cache root. Best-effort:
 *  failures (missing dir, permissions) yield an empty list. */
function listCachedHousingUuids(): string[] {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        const root = Paths.get(String(KNOWLEDGE_ROOT));
        if (!Files.exists(root) || !Files.isDirectory(root)) return [];
        const stream = Files.newDirectoryStream(root);
        const out: string[] = [];
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                const entry = it.next();
                if (!Files.isDirectory(entry)) continue;
                const name = String(entry.getFileName().toString());
                out.push(name);
            }
        } finally {
            try { stream.close(); } catch (_e) { /* ignore */ }
        }
        return out;
    } catch (_e) {
        return [];
    }
}

/** All houses we know about: cache directories ∪ aliased UUIDs ∪ the
 *  currently-detected housing. Deduplicated. */
function knownHouses(): string[] {
    const set = new Set<string>();
    for (const u of listCachedHousingUuids()) set.add(u);
    const aliases = listAliases();
    for (const k in aliases) set.add(k);
    const current = getHousingUuid();
    if (current !== null) set.add(current);
    const out: string[] = [];
    for (const u of set) out.push(u);
    out.sort();
    return out;
}

function houseRow(uuid: string): Element {
    const isCurrent = getHousingUuid() === uuid;
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            // Current-house marker. Filled-target when current, faint circle
            // when not, so a quick scan tells you which row is "you".
            Icon({
                name: isCurrent ? Icons.target : Icons.circle,
                style: {
                    width: { kind: "px", value: 10 },
                    height: { kind: "px", value: 10 },
                },
            }),
            // Alias (or short UUID) — primary label. Big, full grow.
            Text({
                text: () => {
                    const alias = getAlias(uuid);
                    return alias === null ? shortUuid(uuid) : alias;
                },
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            // Faded UUID tail when an alias is set so the user can still
            // tell two aliases apart at a glance.
            Text({
                text: () => (getAlias(uuid) === null ? "" : shortUuid(uuid)),
                color: COLOR_TEXT_FAINT,
            }),
            // Per-house Trust toggle. Shield-check on, plain shield off.
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 4,
                    width: { kind: "px", value: 64 },
                    height: { kind: "grow" },
                    background: () => (isHouseTrusted(uuid) ? TRUST_ON_BG : TRUST_OFF_BG),
                    hoverBackground: () =>
                        isHouseTrusted(uuid) ? TRUST_ON_HOVER : TRUST_OFF_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    setHouseTrust(uuid, !isHouseTrusted(uuid));
                },
                children: [
                    Icon({
                        name: () =>
                            isHouseTrusted(uuid) ? Icons.shieldCheck : Icons.shield,
                    }),
                    Text({
                        text: "Trust",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
            // Per-house Alias button — pencil = "edit this name". 44px
            // wasn't wide enough for icon + label + padding so the hover
            // highlight cut off mid-text; bumped to 56.
            Button({
                icon: Icons.pencil,
                text: "Alias",
                style: {
                    width: { kind: "px", value: 56 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect: Rect) => openAliasPopover(rect, uuid),
            }),
        ],
    });
}

function knowledgeRow(row: ReturnType<typeof getKnowledgeRows>[number]): Element {
    const label = row.importable.type === "EVENT" ? row.importable.event : row.importable.name;
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Text({
                text: GLYPH_DOT,
                color: STATUS_COLOR[row.state],
                tooltip: STATUS_LABEL[row.state],
                tooltipColor: STATUS_COLOR[row.state],
                style: { width: { kind: "px", value: 8 } },
            }),
            Text({
                text: label,
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: row.importable.type,
                color: COLOR_TEXT_DIM,
            }),
        ],
    });
}

function knowledgeRowsSection(): Element {
    return Col({
        style: { gap: 4, height: { kind: "grow" } },
        children: () => {
            const uuid = getHousingUuid();
            const rows = getKnowledgeRows();
            const out: Element[] = [
                Text({
                    text: () => {
                        if (uuid === null) return "Knowledge: (no active house)";
                        return `Knowledge for active house · ${rows.length} importable${rows.length === 1 ? "" : "s"}`;
                    },
                    color: COLOR_TEXT_DIM,
                }),
            ];
            if (rows.length === 0) {
                out.push(
                    Text({
                        text: "No importables loaded — open an import.json on the Importables tab.",
                        color: COLOR_TEXT_FAINT,
                    })
                );
                return out;
            }
            out.push(
                Scroll({
                    id: "knowledge-rows-scroll",
                    style: { height: { kind: "grow" }, gap: 1 },
                    children: rows.map(knowledgeRow),
                })
            );
            return out;
        },
    });
}

function emptyState(): Element {
    return Col({
        style: { gap: 4, padding: 6 },
        children: [
            Text({
                text: "No houses known yet.",
                color: COLOR_TEXT_DIM,
            }),
            Text({
                text: "Run an import or click Detect to register one.",
                color: COLOR_TEXT_FAINT,
            }),
            Button({
                icon: Icons.radar,
                text: "Detect (/wtfmap)",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 18 },
                },
                onClick: () => detectHousing(),
            }),
        ],
    });
}

export function KnowledgeView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: () => {
            const houses = knownHouses();
            if (houses.length === 0) return [emptyState()];
            return [
                Row({
                    style: { gap: 4, height: { kind: "px", value: 18 } },
                    children: [
                        Text({
                            text: () =>
                                `${houses.length} house${houses.length === 1 ? "" : "s"} known`,
                            color: COLOR_TEXT_DIM,
                            style: { width: { kind: "grow" } },
                        }),
                        Button({
                            icon: Icons.radar,
                            text: "Detect",
                            style: {
                                width: { kind: "px", value: 60 },
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: () => detectHousing(),
                        }),
                    ],
                }),
                // Houses get a fixed slot (one row each, capped). The
                // knowledge-rows section underneath gets the remaining grow
                // space — that's the per-importable list the user wants
                // visibility on.
                Col({
                    style: { gap: 2, height: { kind: "px", value: Math.min(houses.length, 4) * (SIZE_ROW_H + 4) + 4 } },
                    children: houses.map(houseRow),
                }),
                knowledgeRowsSection(),
            ];
        },
    });
}
