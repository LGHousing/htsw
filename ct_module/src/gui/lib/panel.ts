/// <reference types="../../../CTAutocomplete" />

import { Element, LaidOut, Rect, layoutElement, pointInRect } from "./layout";
import { Extractable, extract } from "./extractable";
import { drawLaid, dispatchClick } from "./render";
import { getGuiRevision, markGuiDirty, GUI_REBUILD_BACKSTOP_MS } from "./dirty";
import { warmIconTextures } from "./images";
import { debugLogError } from "./debugLog";
import { tryDispatchPopoverClick, popoverIsOpen, mouseIsOverPopover } from "./popovers";
import {
    mouseIsOverHoverCard,
    tryDispatchHoverCardClick,
} from "./hoverCards";
import { mcToOverlay } from "./overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./overlayDraw";
import { recordPanelFrame } from "./framePerf";

const COLOR_PANEL = 0xf0242931 | 0;

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
    private builtAt: number;
    private builtBounds: Rect | null;

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
        this.builtAt = 0;
        this.builtBounds = null;
    }

    public setRoot(root: Element): void {
        this.root = root;
        this.cachedLaid = null;
    }

    private needsRebuild(b: Rect): boolean {
        if (this.cachedLaid === null) return true;
        if (getGuiRevision() !== this.builtRevision) return true;
        if (Date.now() - this.builtAt >= GUI_REBUILD_BACKSTOP_MS) return true;
        const pb = this.builtBounds;
        return (
            pb === null || pb.x !== b.x || pb.y !== b.y || pb.w !== b.w || pb.h !== b.h
        );
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

    public register(): void {
        if (this.renderTrigger !== null) {
            throw new Error("Panel is already registered");
        }
        const paint = (rawX: number, rawY: number) => {
            if (!extract(this.shouldBeVisible)) return;
            const b = extract(this.bounds);
            const x = mcToOverlay(rawX);
            const y = mcToOverlay(rawY);
            beginHtswOverlayDraw();
            warmIconTextures();
            if (this.paintBackground) {
                Renderer.drawRect(COLOR_PANEL, b.x, b.y, b.w, b.h);
            }
            // Hover follows click propagation: panels stay interactive unless the cursor is
            // actually over a popover (in which case the popover absorbs the click).
            const interactive = !mouseIsOverPopover(x, y) && !mouseIsOverHoverCard(x, y);
            const renderStart = Date.now();
            const rebuild = this.needsRebuild(b);
            try {
                if (rebuild) {
                    this.cachedLaid = layoutElement(this.root, b.x, b.y, b.w, b.h);
                    this.builtRevision = getGuiRevision();
                    this.builtAt = Date.now();
                    this.builtBounds = b;
                }
                drawLaid(this.cachedLaid as LaidOut[], this.root, x, y, interactive);
            } catch (err) {
                debugLogError("panel render", err);
            }
            recordPanelFrame(Date.now() - renderStart, rebuild);
            endHtswOverlayDraw();
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
                // A click can change anything the tree shows — rebuild next paint
                // rather than wait for the dirty backstop.
                markGuiDirty();
                const x = mcToOverlay(rawX);
                const y = mcToOverlay(rawY);
                // Popover takes priority. Only one panel should actually run the popover dispatch
                // (since it mutates state and runs onClick once); we use a per-frame guard.
                // Inside-popover click → dispatch + cancel + return. Outside-popover click → close
                // stale popovers but fall through so the click still focuses inputs / hits buttons.
                if (popoverIsOpen() && claimPopoverClick(x, y)) {
                    if (tryDispatchPopoverClick(x, y, btn)) {
                        cancel(event);
                        return;
                    }
                }
                if (tryDispatchHoverCardClick(x, y)) {
                    cancel(event);
                    return;
                }
                if (!extract(this.shouldBeVisible)) return;
                const b = extract(this.bounds);
                if (!pointInRect(b, x, y)) return;
                const laid = layoutElement(this.root, b.x, b.y, b.w, b.h);
                if (dispatchClick(laid, x, y, btn)) cancel(event);
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
