/// <reference types="../../../CTAutocomplete" />

import { Element, Rect } from "../lib/layout";
import { Col, Container, Text } from "../lib/components";
import { openPopover } from "../lib/popovers";
import { getTrustMode, setTrustMode } from "../state";

const ON_BG = 0xff2d4d2d | 0;
const ON_HOVER = 0xff3a5d3a | 0;
const OFF_BG = 0xff2d333d | 0;
const OFF_HOVER = 0xff3a4350 | 0;

function popoverContent(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Text({
                text: "Knowledge Settings",
                style: { width: { kind: "grow" } },
            }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 6,
                    height: { kind: "px", value: 20 },
                    background: () => (getTrustMode() ? ON_BG : OFF_BG),
                    hoverBackground: () => (getTrustMode() ? ON_HOVER : OFF_HOVER),
                },
                onClick: () => setTrustMode(!getTrustMode()),
                children: [
                    Text({
                        text: "Trust mode",
                        style: { width: { kind: "grow" } },
                    }),
                    Text({ text: () => (getTrustMode() ? "[x]" : "[ ]") }),
                ],
            }),
            Text({
                text: "Skips importables whose hash matches the cached entry.",
                color: 0xff888888 | 0,
            }),
        ],
    });
}

export function openKnowledgeSettingsPopover(anchor: Rect): void {
    openPopover({
        anchor,
        content: popoverContent(),
        width: 200,
        height: 64,
        key: "knowledge-settings",
    });
}
