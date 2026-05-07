/// <reference types="../../../../CTAutocomplete" />

import { Element, Rect } from "../../lib/layout";
import { Button, Col, Container, Row, Scroll, Text } from "../../lib/components";
import {
    getHousingUuid,
    isHouseTrusted,
    setHousingUuid,
    setHouseTrust,
} from "../../state";
import { getCurrentHousingUuid } from "../../../knowledge/housingId";
import { getAlias, listAliases } from "../../../knowledge/aliases";
import { openAliasPopover } from "../../popovers/alias";
import { TaskManager } from "../../../tasks/manager";
import { KNOWLEDGE_ROOT } from "../../../knowledge/paths";
import {
    ACCENT_INFO,
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
            // Current-house marker.
            Text({
                text: isCurrent ? "→" : " ",
                color: ACCENT_INFO,
                style: { width: { kind: "px", value: 8 } },
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
            // Per-house Trust toggle.
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
                    Text({
                        text: "Trust",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                    Text({ text: () => (isHouseTrusted(uuid) ? "[x]" : "[ ]") }),
                ],
            }),
            // Per-house Alias button.
            Button({
                text: "Alias",
                style: {
                    width: { kind: "px", value: 36 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect: Rect) => openAliasPopover(rect, uuid),
            }),
        ],
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
                            text: "Detect",
                            style: {
                                width: { kind: "px", value: 50 },
                                height: { kind: "grow" },
                                background: COLOR_BUTTON,
                                hoverBackground: COLOR_BUTTON_HOVER,
                            },
                            onClick: () => detectHousing(),
                        }),
                    ],
                }),
                Scroll({
                    id: "knowledge-houses-scroll",
                    style: { height: { kind: "grow" }, gap: 2 },
                    children: houses.map(houseRow),
                }),
            ];
        },
    });
}
