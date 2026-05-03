/// <reference types="../../CTAutocomplete" />

import { Element, Rect, layoutElement, pointInRect } from "./layout";
import { Extractable, extract } from "./extractable";
import { renderElement, dispatchClick } from "./render";
import { tryDispatchPopoverClick, popoverIsOpen, mouseIsOverPopover } from "./popovers";

const COLOR_PANEL = 0xf0242931 | 0;

export class Panel {
    private bounds: Extractable<Rect>;
    private root: Element;
    private shouldBeVisible: Extractable<boolean>;
    private renderTrigger: Trigger | null;
    private clickTrigger: Trigger | null;

    constructor(
        bounds: Extractable<Rect>,
        root: Element,
        shouldBeVisible: Extractable<boolean>
    ) {
        this.bounds = bounds;
        this.root = root;
        this.shouldBeVisible = shouldBeVisible;
        this.renderTrigger = null;
        this.clickTrigger = null;
    }

    public setRoot(root: Element): void {
        this.root = root;
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
        this.renderTrigger = register(
            "guiRender",
            (x: number, y: number, _gui: MCTGuiScreen) => {
                if (!extract(this.shouldBeVisible)) return;
                const b = extract(this.bounds);
                Renderer.drawRect(COLOR_PANEL, b.x, b.y, b.w, b.h);
                // Hover follows click propagation: panels stay interactive unless the cursor is
                // actually over a popover (in which case the popover absorbs the click).
                const interactive = !mouseIsOverPopover(x, y);
                renderElement(this.root, b.x, b.y, b.w, b.h, x, y, interactive);
            }
        );
        this.clickTrigger = register(
            "guiMouseClick",
            (
                x: number,
                y: number,
                btn: number,
                _gui: MCTGuiScreen,
                event: CancellableEvent
            ) => {
                if (event.isCanceled()) return;
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
