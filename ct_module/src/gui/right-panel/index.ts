/// <reference types="../../../CTAutocomplete" />

import { Element } from "../layout";
import { Button, Col, Row } from "../components";

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Button({
                text: "Right",
                style: { width: { kind: "grow" }, height: { kind: "px", value: 16 } },
                onClick: () => ChatLib.chat("&a[htsw] Right header clicked"),
            }),
            Row({
                style: { gap: 4, height: { kind: "grow" }, align: "start" },
                children: [
                    Button({
                        text: "A",
                        style: {
                            width: { kind: "px", value: 24 },
                            height: { kind: "grow" },
                        },
                        onClick: () => ChatLib.chat("&a[htsw] Right A clicked"),
                    }),
                    Button({
                        text: "fill",
                        style: { width: { kind: "grow" } },
                        onClick: () => ChatLib.chat("&a[htsw] Right fill clicked"),
                    }),
                ],
            }),
        ],
    });
}
