import { Element, Rect } from "../lib/layout";
import { Button, Col, Row, Text } from "../lib/components";
import { closePopover, openPopover, type PopoverHandle } from "../lib/popovers";
import { getAnchorRect } from "../lib/anchors";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "../lib/panel";
import { getOverlayScreenH, getOverlayScreenW } from "../lib/overlayScale";
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
import { setActiveLeftTab } from "../left-panel/tabs";
import { setActiveRightTab } from "../right-panel/selection";

/**
 * First-load walkthrough. Each step can spotlight a named region (anchor
 * rects reported per frame via `anchorKey` containers — see lib/anchors)
 * and run a setup that switches the real tabs, so the user is looking at
 * the actual UI a step describes. The card is a STICKY popover: clicks
 * outside it fall through to the panels, so poking at the GUI mid-tour is
 * allowed and doesn't dismiss the tour.
 */

type TourStep = {
    title: string;
    lines: string[];
    /** lib/anchors key to spotlight; card is placed near it. */
    anchor?: string;
    /** Puts the GUI in the state the step talks about (tab switches). */
    setup?: () => void;
};

const STEPS: TourStep[] = [
    {
        title: "Welcome to HTSW",
        lines: [
            "HTSW turns your Housing into files you can",
            "edit, version, and share — and back again.",
            "This tour points at each part of the overlay.",
        ],
        setup: () => {
            setActiveLeftTab("importables");
            setActiveRightTab("view");
        },
    },
    {
        title: "Two sides of your project",
        lines: [
            "Importables is your FILES; Houses is what's",
            "actually built in the house you're in.",
            "Everything HTSW does moves content between",
            "these two.",
        ],
        anchor: "tour:left-tabs",
    },
    {
        title: "Importables — your files",
        lines: [
            "Each import.json lists functions, items,",
            "regions… Checkboxes queue things to import.",
            "The colored dot: green = matches the house,",
            "yellow = differs, red = never read.",
        ],
        anchor: "tour:left-body",
        setup: () => setActiveLeftTab("importables"),
    },
    {
        title: "View — read before you write",
        lines: [
            "Double-click anything on the left to peek at",
            "its source here (italic tab = temporary).",
            "Right-click → Open in View pins it for real.",
            "Colors show the diff against the house.",
        ],
        anchor: "tour:right-body",
        setup: () => setActiveRightTab("view"),
    },
    {
        title: "Import — files into the house",
        lines: [
            "Queued items land here. Import walks the real",
            "Housing menus for you, with live progress.",
            "Trusting a house skips re-verifying content",
            "HTSW already knows.",
        ],
        anchor: "tour:right-body",
        setup: () => setActiveRightTab("import"),
    },
    {
        title: "Houses — the house into files",
        lines: [
            "Scan lists names (fast). Read into knowledge",
            "(in the export dropdown) pulls full contents.",
            "Export writes house content into your files —",
            "it confirms before overwriting local changes.",
        ],
        anchor: "tour:left-body",
        setup: () => setActiveLeftTab("houses"),
    },
    {
        title: "That's the loop",
        lines: [
            "Edit files → Import. Build in-game → Export.",
            "Bind a file to its house (the house button on",
            "its row) and HTSW lines the two up for you.",
            "Replay this anytime with /htsw tour.",
        ],
        setup: () => {
            setActiveLeftTab("importables");
            setActiveRightTab("view");
        },
    },
];

// Sized for the largest step so the modal doesn't resize while paging.
const MAX_LINES = 4;
const HEIGHT = 8 * 2 + 12 + MAX_LINES * 11 + 4 + 18 + 8;
const HIGHLIGHT_COLOR = COLOR_BUTTON_PRIMARY_HOVER;

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

function currentAnchorRect(): Rect | null {
    const key = STEPS[step].anchor;
    if (key === undefined) return null;
    return getAnchorRect(key);
}

// Put the card OUTSIDE the spotlit region — covering the thing a step is
// describing defeats the point. Thin strips get the card below (or above,
// near the bottom edge); tall panel bodies get it beside, toward screen
// center, where the layout's cutout/inventory gap is. No anchor (or a
// region that didn't render this frame) falls back to upper-screen-center.
function desiredCardPos(w: number, h: number): { x: number; y: number } {
    const r = currentAnchorRect();
    const sw = getOverlayScreenW();
    const sh = getOverlayScreenH();
    if (r === null) {
        return { x: (sw - w) / 2, y: sh / 4 };
    }
    const PAD = 6;
    if (r.h < 60) {
        const x = r.x + (r.w - w) / 2;
        const below = r.y + r.h + PAD;
        const y = below + h <= sh - 2 ? below : r.y - h - PAD;
        return { x, y };
    }
    const regionCenter = r.x + r.w / 2;
    const x = regionCenter < sw / 2 ? r.x + r.w + PAD : r.x - w - PAD;
    return { x, y: r.y + 24 };
}

// placeAnchoredRect aligns the popover's right edge to the anchor's right and
// its top to anchor bottom + 2; a zero-size anchor at (x + w, y - 2) therefore
// lands the card's top-left exactly at (x, y), with the helper's screen
// clamping still protecting the edges.
function cardAnchor(): Rect {
    const w = tourWidth();
    const p = desiredCardPos(w, HEIGHT);
    return { x: p.x + w, y: p.y - 2, w: 0, h: 0 };
}

function finish(): void {
    setTourDone();
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
}

function goTo(next: number): void {
    step = next;
    STEPS[step].setup?.();
    reopen();
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
                        step > 0 && navButton("Back", false, () => goTo(step - 1)),
                        navButton("Skip", false, () => finish()),
                        step < STEPS.length - 1
                            ? navButton("Next", true, () => goTo(step + 1))
                            : navButton("Done", true, () => finish()),
                    ],
                }),
            ];
            return out;
        },
    });
}

// Reopened per step (rather than one reactive popover) because the anchor —
// and therefore placement — changes with the step.
function reopen(): void {
    if (activeHandle !== null) {
        closePopover(activeHandle);
        activeHandle = null;
    }
    activeHandle = openPopover({
        anchor: cardAnchor(),
        content: content(),
        width: tourWidth(),
        height: HEIGHT,
        key: "tour",
        placement: "anchored",
        sticky: true,
        excludeAnchor: false,
        onClose: () => {
            activeHandle = null;
        },
    });
}

export function startTour(): void {
    step = 0;
    STEPS[0].setup?.();
    reopen();
}

export function isTourOpen(): boolean {
    return activeHandle !== null;
}

// Spotlight border around the current step's region. Default-priority
// postGuiRender paints after MC's screen but before the LOWEST-priority
// popover pass, so the card stays on top of the border.
register("postGuiRender", () => {
    if (activeHandle === null) return;
    const r = currentAnchorRect();
    if (r === null) return;
    const t = 2;
    beginHtswOverlayDraw();
    Renderer.drawRect(HIGHLIGHT_COLOR, r.x - t, r.y - t, r.w + t * 2, t);
    Renderer.drawRect(HIGHLIGHT_COLOR, r.x - t, r.y + r.h, r.w + t * 2, t);
    Renderer.drawRect(HIGHLIGHT_COLOR, r.x - t, r.y, t, r.h);
    Renderer.drawRect(HIGHLIGHT_COLOR, r.x + r.w, r.y, t, r.h);
    endHtswOverlayDraw();
});

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
