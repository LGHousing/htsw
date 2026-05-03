/// <reference types="../../CTAutocomplete" />

import { Element, Rect, layoutElement, pointInRect } from "./layout";
import { Extractable, extract } from "./extractable";
import { renderElement, dispatchClick } from "./render";
import { tryDispatchPopoverClick, popoverIsOpen, mouseIsOverPopover } from "./popovers";

const COLOR_PANEL = 0xf0242931 | 0;

// Shared between Panel render and the popover render path: tracks the last
// frame postGuiRender fired so guiRender can no-op when post is working
// (avoids double-painting). On a CT version where postGuiRender never
// fires, this stays at 0 and guiRender always runs as the fallback.
export let lastPostRenderAtMs = 0;
export function bumpLastPostRender(): void {
    lastPostRenderAtMs = Date.now();
}
export function postRecentlyFired(): boolean {
    return Date.now() - lastPostRenderAtMs < 100;
}

// Render helpers used to put GL state back into a known 2D-blit mode.
// MC's slot rendering / item lighting can leave drawString invisible if
// we don't reset; resetGuiState() handles that.
// @ts-ignore
const RenderHelper: any = Java.type("net.minecraft.client.renderer.RenderHelper");
// @ts-ignore
const GlStateManager: any = Java.type("net.minecraft.client.renderer.GlStateManager");

/**
 * Restore the GL state we need for 2D blits + drawString. After MC's slot
 * rendering and GuiInventory potion icons, item-lighting is on, alpha test
 * may be in the wrong mode, and the color is whatever the last sprite
 * tinted it to. drawRect happens to paint anyway (untextured quads), but
 * drawString silently produces nothing visible. Reset here.
 *
 * Uses SRG names since CT 1.8.9 binds the runtime obf-mapped class.
 */
export function resetGuiState(): void {
    try {
        RenderHelper.func_74518_a(); // disableStandardItemLighting
    } catch (_e) {
        try {
            RenderHelper.disableStandardItemLighting();
        } catch (_e2) {
            // ignore
        }
    }
    try {
        GlStateManager.func_179098_w(); // enableTexture2D
    } catch (_e) {
        // ignore
    }
    try {
        GlStateManager.func_179140_f(); // disableLighting
    } catch (_e) {
        // ignore
    }
    try {
        GlStateManager.func_179131_c(1.0, 1.0, 1.0, 1.0); // color(1,1,1,1)
    } catch (_e) {
        // ignore
    }
}

export class Panel {
    private bounds: Extractable<Rect>;
    private root: Element;
    private shouldBeVisible: Extractable<boolean>;
    private paintBackground: boolean;
    private renderTrigger: Trigger | null;
    private clickTrigger: Trigger | null;

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
        const paint = (x: number, y: number) => {
            if (!extract(this.shouldBeVisible)) return;
            const b = extract(this.bounds);
            resetGuiState();
            if (this.paintBackground) {
                Renderer.drawRect(COLOR_PANEL, b.x, b.y, b.w, b.h);
            }
            // Hover follows click propagation: panels stay interactive unless the cursor is
            // actually over a popover (in which case the popover absorbs the click).
            const interactive = !mouseIsOverPopover(x, y);
            renderElement(this.root, b.x, b.y, b.w, b.h, x, y, interactive);
        };
        // We register on BOTH guiRender (fires INSIDE drawScreen, BEFORE
        // slot rendering — so panels are at least visible if the post path
        // is unsupported in this CT build) AND postGuiRender (fires AFTER
        // drawScreen completes, so panels paint over slots/foreground/
        // potion icons). The post path tracks postFiredAtMs and the
        // guiRender path skips when post fired in the last 100ms — so on
        // a working build we paint exactly once per frame, on the post
        // path; on a broken build we fall back to guiRender alone.
        this.renderTrigger = register(
            "postGuiRender",
            (x: number, y: number, _gui: MCTGuiScreen) => {
                bumpLastPostRender();
                paint(x, y);
            }
        );
        register(
            "guiRender",
            (x: number, y: number, _gui: MCTGuiScreen) => {
                if (postRecentlyFired()) return;
                paint(x, y);
            }
        );
        this.clickTrigger = register(
            "guiMouseClick",
            (
                x: number,
                y: number,
                _btn: number,
                _gui: MCTGuiScreen,
                event: CancellableEvent
            ) => {
                if (event.isCanceled()) return;
                // Popover takes priority. Only one panel should actually run the popover dispatch
                // (since it mutates state and runs onClick once); we use a per-frame guard.
                // Inside-popover click → dispatch + cancel + return. Outside-popover click → close
                // stale popovers but fall through so the click still focuses inputs / hits buttons.
                if (popoverIsOpen() && claimPopoverClick(x, y)) {
                    if (tryDispatchPopoverClick(x, y)) {
                        cancel(event);
                        return;
                    }
                }
                if (!extract(this.shouldBeVisible)) return;
                const b = extract(this.bounds);
                if (!pointInRect(b, x, y)) return;
                const laid = layoutElement(this.root, b.x, b.y, b.w, b.h);
                if (dispatchClick(laid, x, y)) cancel(event);
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
