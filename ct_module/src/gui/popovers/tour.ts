import { Element } from "../lib/layout";
import { Button, Col, Row, Text } from "../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import { isTourDone, setTourDone } from "../persistence/onboarding";

/**
 * First-load walkthrough: one modal that pages through short steps with
 * Back/Next/Skip. Steps describe where to look rather than anchoring to
 * specific widgets — element-anchored spotlighting would break silently on
 * every layout change, so v1 keeps the tour layout-independent.
 */

type TourStep = { title: string; lines: string[] };

const STEPS: TourStep[] = [
    {
        title: "Welcome to HTSW",
        lines: [
            "HTSW turns your Housing into files you can",
            "edit, version, and share — and back again.",
            "This overlay appears around any Housing menu.",
        ],
    },
    {
        title: "Importables (left panel)",
        lines: [
            "Your files. Open an import.json with Browse,",
            "or start from the sample project.",
            "Checkboxes queue things to import; the colored",
            "dot is how each item compares to the house.",
        ],
    },
    {
        title: "View & Import (right panel)",
        lines: [
            "View shows source with a diff against the",
            "house — double-click any row to peek (italic",
            "tab), right-click → Open in View to pin it.",
            "Import runs the queue with live progress.",
        ],
    },
    {
        title: "Houses (left panel, second tab)",
        lines: [
            "What's actually in the house. Scan lists names",
            "(fast); Read into knowledge (in the export",
            "menu) pulls full contents (slow). Export",
            "writes house content back into your files.",
        ],
    },
    {
        title: "Binding files to houses",
        lines: [
            "The house button on an import.json row binds",
            "the file to the house you're standing in.",
            "Entering a bound house auto-selects its file",
            "as the export destination.",
        ],
    },
    {
        title: "That's the loop",
        lines: [
            "Edit files → Import. Build in-game → Export.",
            "Knowledge tracks what the house looked like",
            "last time HTSW read it.",
            "Replay this anytime with /htsw tour.",
        ],
    },
];

// Sized for the largest step so the modal doesn't resize while paging.
const MAX_LINES = 4;
const HEIGHT = 8 * 2 + 12 + MAX_LINES * 11 + 4 + 18 + 8;

function tourWidth(): number {
    let w = 0;
    for (let i = 0; i < STEPS.length; i++) {
        w = Math.max(w, Renderer.getStringWidth(STEPS[i].title) + 30);
        for (let j = 0; j < STEPS[i].lines.length; j++) {
            w = Math.max(w, Renderer.getStringWidth(STEPS[i].lines[j]));
        }
    }
    return Math.max(260, Math.min(380, w + 20));
}

let activeHandle: PopoverHandle | null = null;
let step = 0;

function finish(): void {
    setTourDone();
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

function navButton(label: string, primary: boolean, onClick: () => void): Element {
    return Button({
        text: label,
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: primary ? COLOR_BUTTON_PRIMARY : COLOR_BUTTON,
            hoverBackground: primary ? COLOR_BUTTON_PRIMARY_HOVER : COLOR_BUTTON_HOVER,
        },
        onClick,
    });
}

function content(): Element {
    return Col({
        style: { padding: 8, gap: 4, height: { kind: "grow" } },
        children: () => {
            const s = STEPS[step];
            const out: Element[] = [
                Row({
                    style: { gap: 4 },
                    children: [
                        Text({
                            text: s.title,
                            color: COLOR_TEXT,
                            style: { width: { kind: "grow" } },
                        }),
                        Text({
                            text: `${step + 1}/${STEPS.length}`,
                            color: COLOR_TEXT_FAINT,
                        }),
                    ],
                }),
                ...s.lines.map((l) => Text({ text: l, color: COLOR_TEXT_DIM })),
                Col({ style: { height: { kind: "grow" } }, children: [] }),
                Row({
                    style: { gap: 4, height: { kind: "px", value: 18 } },
                    children: [
                        step > 0 &&
                            navButton("Back", false, () => {
                                step--;
                            }),
                        navButton("Skip", false, () => finish()),
                        step < STEPS.length - 1
                            ? navButton("Next", true, () => {
                                  step++;
                              })
                            : navButton("Done", true, () => finish()),
                    ],
                }),
            ];
            return out;
        },
    });
}

export function startTour(): void {
    step = 0;
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
    activeHandle = openPopover({
        anchor: { x: 0, y: 0, w: 0, h: 0 },
        content: content(),
        width: tourWidth(),
        height: HEIGHT,
        key: "tour",
        placement: "modal",
        onClose: () => {
            activeHandle = null;
        },
    });
}

export function isTourOpen(): boolean {
    return activeHandle !== null;
}

// Once-per-session auto-start, checked from the overlay tick when the GUI is
// actually visible (popovers can't render without an open screen). /htsw tour
// re-arms it so the reset takes effect without a /ct reload.
let autoChecked = false;

export function maybeAutoStartTour(): void {
    if (autoChecked) return;
    autoChecked = true;
    if (!isTourDone()) startTour();
}

export function rearmTourAutoStart(): void {
    autoChecked = false;
}
