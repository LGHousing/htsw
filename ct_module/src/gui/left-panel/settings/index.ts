/// <reference types="../../../../CTAutocomplete" />

import { Element } from "../../layout";
import { Col, Container, Text } from "../../components";
import { getTrustMode, setTrustMode } from "../../state";

const ON_BG = 0xff2d4d2d | 0;
const ON_HOVER = 0xff3a5d3a | 0;
const OFF_BG = 0xff2d333d | 0;
const OFF_HOVER = 0xff3a4350 | 0;

export function SettingsView(): Element {
    return Col({
        style: { gap: 6, height: { kind: "grow" }, padding: 4 },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 6,
                    height: { kind: "px", value: 18 },
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
