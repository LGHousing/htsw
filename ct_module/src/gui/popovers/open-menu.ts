/// <reference types="../../../CTAutocomplete" />

import { Rect } from "../lib/layout";
import { Col, Container, Text } from "../lib/components";
import { togglePopover } from "../lib/popovers";
import { COLOR_ROW, COLOR_ROW_HOVER, COLOR_TEXT, SIZE_ROW_H } from "../lib/theme";

/** Hypixel housing chat-command shortcuts surfaced in the toolbar dropdown. */
type OpenTargetId =
    | "functions"
    | "eventactions"
    | "regions"
    | "menus";

type OpenTarget = { id: OpenTargetId; label: string; command: string };

const OPEN_TARGETS: OpenTarget[] = [
    { id: "functions", label: "Functions", command: "/functions" },
    { id: "eventactions", label: "Event Actions", command: "/eventactions" },
    { id: "regions", label: "Regions", command: "/regions" },
    { id: "menus", label: "Menus", command: "/menus" },
];

const PERSIST_PATH =
    "./config/ChatTriggers/modules/HTSW/gui-open-target.json";

let lastTarget: OpenTargetId = "functions";
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        if (!FileLib.exists(PERSIST_PATH)) return;
        const raw = String(FileLib.read(PERSIST_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === "string") {
            for (let i = 0; i < OPEN_TARGETS.length; i++) {
                if (OPEN_TARGETS[i].id === parsed.id) {
                    lastTarget = parsed.id;
                    return;
                }
            }
        }
    } catch (_e) {
        // ignore
    }
}

function persist(): void {
    try {
        FileLib.write(PERSIST_PATH, JSON.stringify({ id: lastTarget }, null, 2), true);
    } catch (_e) {
        // ignore
    }
}

export function getLastOpenTarget(): OpenTarget {
    load();
    for (let i = 0; i < OPEN_TARGETS.length; i++) {
        if (OPEN_TARGETS[i].id === lastTarget) return OPEN_TARGETS[i];
    }
    return OPEN_TARGETS[0];
}

export function runOpenTarget(target: OpenTarget): void {
    load();
    lastTarget = target.id;
    persist();
    try {
        ChatLib.command(target.command.replace(/^\//, ""));
    } catch (err) {
        ChatLib.chat(`&c[htsw] command failed: ${err}`);
    }
}

export function openOpenTargetMenu(anchor: Rect): void {
    togglePopover({
        key: "open-target-menu",
        anchor,
        content: Col({
            style: { gap: 2, padding: 4 },
            children: OPEN_TARGETS.map((t) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 8 },
                        gap: 6,
                        height: { kind: "px", value: SIZE_ROW_H },
                        background: COLOR_ROW,
                        hoverBackground: COLOR_ROW_HOVER,
                    },
                    onClick: () => runOpenTarget(t),
                    children: [
                        Text({
                            text: t.command,
                            color: COLOR_TEXT,
                            style: { width: { kind: "grow" } },
                        }),
                        Text({ text: t.label, color: 0xff888888 | 0 }),
                    ],
                })
            ),
        }),
        width: 200,
        height: OPEN_TARGETS.length * 20 + 8,
    });
}
