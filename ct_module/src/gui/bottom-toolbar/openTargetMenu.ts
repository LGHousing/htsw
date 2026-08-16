/// <reference types="../../../CTAutocomplete" />

import { Rect } from "../lib/layout";
import { Col, Container, Text } from "../lib/components";
import { togglePopover } from "../lib/popovers";
import { COLOR_ROW, COLOR_ROW_HOVER, COLOR_TEXT, SIZE_ROW_H } from "../lib/theme";
import { asEnum, defineDoc, defineValue } from "../../persistence/store";

/** Hypixel housing chat-command shortcuts surfaced in the toolbar dropdown. */
type OpenTargetId = "functions" | "eventactions" | "regions" | "menus";

type OpenTarget = { id: OpenTargetId; label: string; command: string };

const OPEN_TARGETS: OpenTarget[] = [
    { id: "functions", label: "Functions", command: "/functions" },
    { id: "eventactions", label: "Event Actions", command: "/eventactions" },
    { id: "regions", label: "Regions", command: "/regions" },
    { id: "menus", label: "Menus", command: "/menus" },
];

const OPEN_TARGET = defineDoc({
    file: "open-target.json",
    legacyPaths: ["./config/ChatTriggers/modules/HTSW/gui-open-target.json"],
    onReadError: "defaults",
    pretty: true,
});

const lastTarget = defineValue<OpenTargetId>(OPEN_TARGET, {
    key: "id",
    fallback: "functions",
    parse: asEnum(["functions", "eventactions", "regions", "menus"] as const),
});

export function getLastOpenTarget(): OpenTarget {
    const id = lastTarget.get();
    for (let i = 0; i < OPEN_TARGETS.length; i++) {
        if (OPEN_TARGETS[i].id === id) return OPEN_TARGETS[i];
    }
    return OPEN_TARGETS[0];
}

export function runOpenTarget(target: OpenTarget): void {
    lastTarget.set(target.id);
    try {
        ChatLib.command(target.command.replace(/^\//, ""));
    } catch (err) {
        ChatLib.chat(`&c[htsw] command failed: ${String(err)}`);
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
