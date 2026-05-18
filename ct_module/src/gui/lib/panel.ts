/// <reference types="../../CTAutocomplete" />

import { Element, Rect, layoutElement, pointInRect } from "./layout";
import { Extractable, extract } from "./extractable";
import { renderElement, dispatchClick } from "./render";
import { tryDispatchPopoverClick, popoverIsOpen, mouseIsOverPopover } from "./popovers";
import { getEffectiveOverlayScale, getMcScale, mcToOverlay } from "./overlayScale";
import { GL11, javaType } from "./java";

const COLOR_PANEL = 0xf0242931 | 0;

const RenderHelper: any = javaType("net.minecraft.client.renderer.RenderHelper");
const GlStateManager: any = javaType("net.minecraft.client.renderer.GlStateManager");

/**
 * Restore the GL state we need for 2D blits + drawString. After MC's slot
 * rendering and GuiInventory potion icons, item-lighting is on, alpha test
 * may be in the wrong mode, and the color is whatever the last sprite
 * tinted it to. drawRect happens to paint anyway (untextured quads), but
 * drawString silently produces nothing visible. Reset here.
 *
 * Uses SRG names since CT 1.8.9 binds the runtime obf-mapped class.
 */
function resetGuiState(): void {
    try {
        GL11.glDisable(GL11.GL_SCISSOR_TEST);
    } catch (_e) {
        // ignore
    }
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
    try {
        GlStateManager.func_179097_i(); // disableDepth
    } catch (_e) {
        try {
            GL11.glDisable(GL11.GL_DEPTH_TEST);
        } catch (_e2) {
            // ignore
        }
    }
    try {
        GL11.glDepthMask(false);
    } catch (_e) {
        // ignore
    }
    try {
        GlStateManager.func_179147_l(); // enableBlend
    } catch (_e) {
        try {
            GL11.glEnable(GL11.GL_BLEND);
        } catch (_e2) {
            // ignore
        }
    }
    try {
        GlStateManager.func_179120_a(770, 771, 1, 0); // tryBlendFuncSeparate
    } catch (_e) {
        try {
            GL11.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA);
        } catch (_e2) {
            // ignore
        }
    }
}

export function beginHtswOverlayDraw(): void {
    resetGuiState();
    // Force the overlay to render at the effective overlay scale (= OVERLAY_SCALE_TARGET
    // capped to MC's current scale, so we never try to render bigger than MC itself when the
    // window is small). MC's projection draws 1 scaled unit as `mcScale` real pixels; we want
    // 1 overlay unit to be `effectiveOverlayScale` real pixels, so apply factor
    // effectiveOverlayScale / mcScale (= 1 when MC is already at-or-below our cap).
    // We push BOTH matrices: scale on the projection (which MC re-binds on every drawScreen
    // and which downstream rendering paths don't usually re-touch), and translate-Z on the
    // modelview so we still draw above other GUI elements. Doing the scale on projection
    // means even rendering paths that re-load the modelview matrix internally still get our
    // scale applied through the projection.
    const f = getEffectiveOverlayScale() / getMcScale();
    GL11.glMatrixMode(GL11.GL_PROJECTION);
    GL11.glPushMatrix();
    GL11.glScalef(f, f, 1);
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glPushMatrix();
    GL11.glTranslated(0, 0, 1000);
}

export function endHtswOverlayDraw(): void {
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glPopMatrix();
    GL11.glMatrixMode(GL11.GL_PROJECTION);
    GL11.glPopMatrix();
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glDepthMask(true);
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
        const paint = (rawX: number, rawY: number) => {
            if (!extract(this.shouldBeVisible)) return;
            const b = extract(this.bounds);
            const x = mcToOverlay(rawX);
            const y = mcToOverlay(rawY);
            beginHtswOverlayDraw();
            if (this.paintBackground) {
                Renderer.drawRect(COLOR_PANEL, b.x, b.y, b.w, b.h);
            }
            // Hover follows click propagation: panels stay interactive unless the cursor is
            // actually over a popover (in which case the popover absorbs the click).
            const interactive = !mouseIsOverPopover(x, y);
            renderElement(this.root, b.x, b.y, b.w, b.h, x, y, interactive);
            endHtswOverlayDraw();
        };
        // CT's "guiRender" maps to Forge's BackgroundDrawnEvent — fires after MC's dim gradient
        // but before slot/foreground/tooltip rendering, so MC's hover tooltip on container
        // slots paints on top of our right panel instead of being covered. Inventory bg + items
        // paint after us too, but our panels sit around the inventory (not over it) so they
        // don't actually overlap pixel-wise. Popovers stay on postGuiRender (LOWEST) so they
        // remain modal above the tooltip.
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
