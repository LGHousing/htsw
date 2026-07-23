/// <reference types="../../../CTAutocomplete" />

import {
    advanceScrollForPaint,
    Element,
    getScrollState,
    LaidOut,
    Rect,
    layoutElement,
    pointInRect,
} from "./layout";
import { Extractable, extract } from "./extractable";
import { drawLaid, dispatchClick } from "./render";
import { getGuiRevision, markGuiDirty } from "./dirty";
import { warmIconTextures } from "./images";
import { debugLogError } from "./debugLog";
import { tryDispatchPopoverClick, popoverIsOpen, mouseIsOverPopover } from "./popovers";
import {
    mouseIsOverHoverCard,
    tryDispatchHoverCardClick,
} from "./hoverCards";
import { mcToOverlay } from "./overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./overlayDraw";
import { recordPanelFrame, recordPhase } from "./framePerf";

const COLOR_PANEL = 0xf0242931 | 0;

function translateClipGroup(laid: LaidOut[], clip: Rect, dx: number, dy: number): void {
    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.clipRect !== clip) continue;
        item.rect.x += dx;
        item.rect.y += dy;
        if (item.element.kind !== "scroll") continue;
        const nestedClip = getScrollState(item.element.id).viewportRect;
        nestedClip.x += dx;
        nestedClip.y += dy;
        translateClipGroup(laid, nestedClip, dx, dy);
    }
}

export class Panel {
    private bounds: Extractable<Rect>;
    private root: Element;
    private shouldBeVisible: Extractable<boolean>;
    private paintBackground: boolean;
    private renderTrigger: Trigger | null;
    private clickTrigger: Trigger | null;
    // Retained layout: the laid-out tree from the last rebuild, reused on frames
    // where nothing structural changed. See lib/dirty for when we rebuild.
    private cachedLaid: LaidOut[] | null;
    private builtRevision: number;
    private builtBounds: Rect | null;
    private builtScrollOffsets: { [id: string]: number };
    private displayedScrollOffsets: { [id: string]: number };

    constructor(
        bounds: Extractable<Rect>,
        root: Element,
        shouldBeVisible: Extractable<boolean>,
        paintBackground: boolean = true
    ) {
        this.bounds = bounds;
        this.root = root;
        this.shouldBeVisible = shouldBeVisible;
        this.paintBackground = paintBackground;
        this.renderTrigger = null;
        this.clickTrigger = null;
        this.cachedLaid = null;
        this.builtRevision = -1;
        this.builtBounds = null;
        this.builtScrollOffsets = {};
        this.displayedScrollOffsets = {};
    }

    public setRoot(root: Element): void {
        this.root = root;
        this.cachedLaid = null;
    }

    private needsRebuild(b: Rect): boolean {
        if (this.cachedLaid === null) return true;
        if (getGuiRevision() !== this.builtRevision) return true;
        const pb = this.builtBounds;
        return (
            pb === null || pb.x !== b.x || pb.y !== b.y || pb.w !== b.w || pb.h !== b.h
        );
    }

    private captureScrollOffsets(): void {
        this.builtScrollOffsets = {};
        this.displayedScrollOffsets = {};
        const laid = this.cachedLaid as LaidOut[];
        for (let i = 0; i < laid.length; i++) {
            const element = laid[i].element;
            if (element.kind !== "scroll") continue;
            const offset = getScrollState(element.id).offset;
            this.builtScrollOffsets[element.id] = offset;
            this.displayedScrollOffsets[element.id] = offset;
        }
    }

    private advanceCachedScrolls(): boolean {
        const laid = this.cachedLaid as LaidOut[];
        const shifts: { clip: Rect; dx: number; dy: number }[] = [];
        for (let i = 0; i < laid.length; i++) {
            const element = laid[i].element;
            if (element.kind !== "scroll") continue;
            const state = getScrollState(element.id);
            const previous = this.displayedScrollOffsets[element.id] ?? state.offset;
            const next = advanceScrollForPaint(element.id);
            const built = this.builtScrollOffsets[element.id] ?? next;
            if (Math.abs(next - built) > 24) return false;
            const delta = Math.round(previous) - Math.round(next);
            if (delta !== 0) {
                shifts.push({
                    clip: state.viewportRect,
                    dx: state.axis === "x" ? delta : 0,
                    dy: state.axis === "y" ? delta : 0,
                });
            }
            this.displayedScrollOffsets[element.id] = next;
        }
        for (let i = 0; i < shifts.length; i++) {
            translateClipGroup(laid, shifts[i].clip, shifts[i].dx, shifts[i].dy);
        }
        return true;
    }
    public setBounds(bounds: Extractable<Rect>): void {
        this.bounds = bounds;
    }
    public getBounds(): Rect {
        return extract(this.bounds);
    }
    public isVisible(): boolean {
        return extract(this.shouldBeVisible);
    }
    public getRoot(): Element {
        return this.root;
    }
    public getLaidOut(): LaidOut[] | null {
        return this.cachedLaid;
    }

    public drawAt(rawX: number, rawY: number): void {
        const b = extract(this.bounds);
        const x = mcToOverlay(rawX);
        const y = mcToOverlay(rawY);
        warmIconTextures();
        if (this.paintBackground) {
            Renderer.drawRect(COLOR_PANEL, b.x, b.y, b.w, b.h);
        }
        const interactive = !mouseIsOverPopover(x, y) && !mouseIsOverHoverCard(x, y);
        const renderStart = Date.now();
        let rebuild = this.needsRebuild(b);
        try {
            if (!rebuild && !this.advanceCachedScrolls()) rebuild = true;
            if (rebuild) {
                const layoutStart = Date.now();
                this.cachedLaid = layoutElement(this.root, b.x, b.y, b.w, b.h);
                recordPhase("layout-total", Date.now() - layoutStart);
                this.builtRevision = getGuiRevision();
                this.builtBounds = b;
                this.captureScrollOffsets();
            }
            const drawStart = Date.now();
            drawLaid(this.cachedLaid as LaidOut[], this.root, x, y, interactive);
            if (rebuild) recordPhase("draw-rebuild", Date.now() - drawStart);
        } catch (err) {
            debugLogError("panel render", err);
        }
        recordPanelFrame(Date.now() - renderStart, rebuild);
    }

    public clickAt(rawX: number, rawY: number, btn: number): boolean {
        const x = mcToOverlay(rawX);
        const y = mcToOverlay(rawY);
        if (popoverIsOpen() && claimPopoverClick(x, y)) {
            if (tryDispatchPopoverClick(x, y, btn)) {
                markGuiDirty();
                return true;
            }
        }
        if (tryDispatchHoverCardClick(x, y)) return true;
        if (!extract(this.shouldBeVisible)) return false;
        const b = extract(this.bounds);
        if (!pointInRect(b, x, y)) return false;
        const pb = this.builtBounds;
        const laid =
            this.cachedLaid !== null &&
            pb !== null &&
            pb.x === b.x &&
            pb.y === b.y &&
            pb.w === b.w &&
            pb.h === b.h
                ? this.cachedLaid
                : layoutElement(this.root, b.x, b.y, b.w, b.h);
        const consumed = dispatchClick(laid, x, y, btn);
        if (consumed) markGuiDirty();
        return consumed;
    }

    public register(): void {
        if (this.renderTrigger !== null) {
            throw new Error("Panel is already registered");
        }
        const paint = (rawX: number, rawY: number) => {
            if (!extract(this.shouldBeVisible)) return;
            beginHtswOverlayDraw();
            try {
                this.drawAt(rawX, rawY);
            } finally {
                endHtswOverlayDraw();
            }
        };
        // CT's "guiRender" maps to Forge's BackgroundDrawnEvent — fires after MC's dim gradient
        // but before slot/foreground/tooltip rendering, so MC's hover tooltip on container
        // slots paints on top of our right panel instead of being covered. Inventory bg + items
        // paint after us too, but our panels sit around the inventory (not over it) so they
        // don't actually overlap pixel-wise. Popovers and our own hover tooltips stay on
        // postGuiRender (LOWEST) so they paint above MC's inventory/foreground.
        this.renderTrigger = register(
            "guiRender",
            (x: number, y: number, _gui: MCTGuiScreen) => paint(x, y)
        ).setPriority(OnTrigger.Priority.LOW);
        this.clickTrigger = register(
            "guiMouseClick",
            (
                rawX: number,
                rawY: number,
                btn: number,
                _gui: MCTGuiScreen,
                event: CancellableEvent
            ) => {
                if (event.isCanceled()) return;
                if (this.clickAt(rawX, rawY, btn)) cancel(event);
            }
        );
    }

    public deregister(): void {
        if (this.renderTrigger === null || this.clickTrigger === null) {
            throw new Error("Panel is not registered");
        }
        this.renderTrigger.unregister();
        this.clickTrigger.unregister();
        this.renderTrigger = null;
        this.clickTrigger = null;
    }
}

// Per-click guard so popover dispatch fires once even when multiple panel handlers see the same
// click event (each panel registers its own guiMouseClick trigger).
let lastClaimedClickKey = "";
function claimPopoverClick(x: number, y: number): boolean {
    const key = `${Date.now()}|${x}|${y}`;
    if (key === lastClaimedClickKey) return false;
    lastClaimedClickKey = key;
    return true;
}
