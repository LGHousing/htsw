/// <reference types="../../CTAutocomplete" />

import { Panel } from "./panel";
import { Element } from "./layout";
import { Button, Col, Row } from "./components";

const PANEL_WIDTH = 100;
const PANEL_HEIGHT = 70;

const LEFT_PANEL_X = 10;
const LEFT_PANEL_Y = 40;
const RIGHT_PANEL_X = 120;
const RIGHT_PANEL_Y = 40;

let enabled = true;
let initialized = false;

function isVisible(): boolean { return enabled; }

function buildRoot(label: string): Element {
    return Col({
        style: { padding: 6, gap: 4 },
        children: [
            Button({
                text: label,
                style: { width: { kind: "grow" }, height: { kind: "px", value: 16 } },
                onClick: () => ChatLib.chat(`&a[htsw] ${label} header clicked`),
            }),
            Row({
                style: { gap: 4, height: { kind: "grow" }, padding: { side: "y", value: 2 } },
                children: [
                    Button({
                        text: "A",
                        style: { width: { kind: "px", value: 24 }, height: { kind: "grow" } },
                        onClick: () => ChatLib.chat(`&a[htsw] ${label} A clicked`),
                    }),
                    Button({
                        text: "fill",
                        style: { width: { kind: "grow" }, height: { kind: "grow" } },
                        onClick: () => ChatLib.chat(`&a[htsw] ${label} fill clicked`),
                    }),
                ],
            }),
        ],
    });
}

function ensureInitialized(): void {
    if (initialized) return;
    initialized = true;
    new Panel(LEFT_PANEL_X, LEFT_PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, buildRoot("Left"), isVisible).register();
    new Panel(RIGHT_PANEL_X, RIGHT_PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, buildRoot("Right"), isVisible).register();
}

export function toggleHtswGui(): boolean {
    ensureInitialized();
    enabled = !enabled;
    return enabled;
}

export function armHtswGuiDebug(_frames: number): void {
    ensureInitialized();
}
