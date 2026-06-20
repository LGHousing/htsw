/// <reference types="../../../CTAutocomplete" />

import { Element, Rect, pointInRect, layoutElement } from "./layout";
import {
    renderElement,
    dispatchClick,
    dispatchWheel,
    hasDeferredTooltip,
    drawDeferredTooltip,
} from "./render";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./panel";
import { getOverlayScreenW, getOverlayScreenH, mcToOverlay } from "./overlayScale";
import { placeAnchoredRect } from "./anchoredRect";
import { debugLogError } from "./debugLog";

export type PopoverHandle = {
    id: number;
    key?: string;
    anchor: Rect;
    // When true, an outside-click on `anchor` keeps the popover open. This is what makes a
    // button-style trigger (Sort/Filter) toggle correctly — without it, the same click that
    // hits the trigger would also auto-close the popover, racing with togglePopover. For
    // cursor-anchored menus that have no re-clickable trigger, set this false.
    excludeAnchor: boolean;
    content: Element;
    width: number;
    height: number;
    openedAt: number;
    /**
     * "anchored" — placed adjacent to the trigger anchor (default).
     * "modal"    — centered on the screen and a full-screen scrim is drawn
     *              behind it; outside-clicks still close after the grace
     *              window so the user can dismiss by clicking off.
     */
    placement: "anchored" | "modal";
    /** Survives outside-clicks: the click neither dismisses this popover nor
     * is absorbed — it falls through to the panels, so the user can keep
     * using the GUI with the popover up (the tour card). Close it
     * programmatically or via its own buttons. */
    sticky: boolean;
    onClose?: () => void;
};

import { COLOR_OVERLAY_DIM, COLOR_PANEL, COLOR_PANEL_BORDER } from "./theme";

let nextId = 1;
let openPopovers: PopoverHandle[] = [];
let renderInitialized = false;

export function openPopover(opts: {
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    key?: string;
    placement?: "anchored" | "modal";
    excludeAnchor?: boolean;
    sticky?: boolean;
    onClose?: () => void;
}): PopoverHandle {
    const handle: PopoverHandle = {
        id: nextId++,
        key: opts.key,
        anchor: opts.anchor,
        excludeAnchor: opts.excludeAnchor !== false,
        content: opts.content,
        width: opts.width,
        height: opts.height,
        openedAt: Date.now(),
        placement: opts.placement ?? "anchored",
        sticky: opts.sticky === true,
        onClose: opts.onClose,
    };
    openPopovers.push(handle);
    return handle;
}

// Open a popover keyed by `key`; if one with the same key is already open, close it instead.
// Use this for toggle-style triggers (e.g. a Filter button that re-clicks to dismiss).
export function togglePopover(opts: {
    key: string;
    anchor: Rect;
    content: Element;
    width: number;
    height: number;
    placement?: "anchored" | "modal";
    onClose?: () => void;
}): PopoverHandle | null {
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].key === opts.key) {
            closePopover(openPopovers[i]);
            return null;
        }
    }
    return openPopover(opts);
}

export function closePopover(handle: PopoverHandle): void {
    const idx = openPopovers.indexOf(handle);
    if (idx < 0) return;
    openPopovers.splice(idx, 1);
    if (handle.onClose) handle.onClose();
}

// Tears down transient popovers (context menus, forms, pickers). Sticky
// popovers (the tour card) are KEPT by default — their contract is "close
// programmatically or via own buttons", so a context menu or form opening
// underneath must not whisk the tour away. Pass includeSticky only for a
// genuine teardown (the inventory/overlay is gone).
export function closeAllPopovers(includeSticky: boolean = false): void {
    const kept: PopoverHandle[] = [];
    const closing: PopoverHandle[] = [];
    for (let i = 0; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        if (p.sticky && !includeSticky) kept.push(p);
        else closing.push(p);
    }
    openPopovers = kept;
    for (let i = 0; i < closing.length; i++) {
        if (closing[i].onClose) closing[i].onClose!();
    }
}

export function popoverIsOpen(): boolean {
    return openPopovers.length > 0;
}

/**
 * Element trees of all currently-open popovers, in open-order. Used by
 * the keyboard input handler so a focused input INSIDE a popover (not
 * inside any registered panel) can still be located by id.
 */
export function getOpenPopoverContents(): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < openPopovers.length; i++) {
        out.push(openPopovers[i].content);
    }
    return out;
}

function computePopoverRect(p: PopoverHandle): Rect {
    const screenH = getOverlayScreenH();
    const screenW = getOverlayScreenW();
    if (p.placement === "modal") {
        const w = Math.min(p.width, screenW - 8);
        const h = Math.min(p.height, screenH - 8);
        return {
            x: Math.floor((screenW - w) / 2),
            y: Math.floor((screenH - h) / 2),
            w,
            h,
        };
    }
    return placeAnchoredRect(p.anchor, p.width, p.height, screenW, screenH);
}

function closePopoversAbove(index: number): boolean {
    if (index >= openPopovers.length - 1) return false;
    const kept: PopoverHandle[] = [];
    for (let i = 0; i <= index; i++) kept.push(openPopovers[i]);
    let closedModal = false;
    for (let i = index + 1; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        if (p.sticky) {
            kept.push(p);
            continue;
        }
        if (p.placement === "modal") closedModal = true;
        if (p.onClose) p.onClose();
    }
    openPopovers = kept;
    return closedModal;
}

// Called by panel click handlers BEFORE their own dispatch. Returns true if the click was
// inside any popover (handler invoked, event should be cancelled by caller). Returns false
// if the click was outside all popovers — caller should also return without dispatching.
// On outside click, popovers older than OPEN_GRACE_MS are closed.
export function tryDispatchPopoverClick(
    mouseX: number,
    mouseY: number,
    button: number
): boolean {
    if (openPopovers.length === 0) return false;
    for (let i = openPopovers.length - 1; i >= 0; i--) {
        const p = openPopovers[i];
        const rect = computePopoverRect(p);
        if (pointInRect(rect, mouseX, mouseY)) {
            if (closePopoversAbove(i)) return true;
            const laid = layoutElement(p.content, rect.x, rect.y, rect.w, rect.h);
            dispatchClick(laid, mouseX, mouseY, button);
            return true;
        }
    }
    // Outside all popovers: close them, EXCEPT when the click is on the popover's own
    // anchor (the trigger). Auto-closing in that case races with togglePopover and you'd need
    // to click the trigger twice to dismiss.
    const fresh: PopoverHandle[] = [];
    const stale: PopoverHandle[] = [];
    for (let i = 0; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        const onAnchor = p.excludeAnchor && pointInRect(p.anchor, mouseX, mouseY);
        if (onAnchor || p.sticky) fresh.push(p);
        else stale.push(p);
    }
    let closedModal = false;
    if (stale.length > 0) {
        openPopovers = fresh;
        for (let i = 0; i < stale.length; i++) {
            if (stale[i].placement === "modal") closedModal = true;
            if (stale[i].onClose) stale[i].onClose!();
        }
    }
    // Modals are interaction-blocking: absorb the click if any modal is still open OR if
    // the outside-click is what just closed a modal (so the dismissing click doesn't also
    // hit a button/input underneath).
    if (closedModal) return true;
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].placement === "modal") return true;
    }
    return false;
}

function drawPopovers(mouseX: number, mouseY: number): void {
    if (openPopovers.length === 0) return;
    beginHtswOverlayDraw();
    let scrimDrawn = false;
    for (let i = 0; i < openPopovers.length; i++) {
        const p = openPopovers[i];
        if (p.placement === "modal" && !scrimDrawn) {
            const sw = getOverlayScreenW();
            const sh = getOverlayScreenH();
            Renderer.drawRect(COLOR_OVERLAY_DIM, 0, 0, sw, sh);
            scrimDrawn = true;
        }
        const rect = computePopoverRect(p);
        Renderer.drawRect(
            COLOR_PANEL_BORDER,
            rect.x - 1,
            rect.y - 1,
            rect.w + 2,
            rect.h + 2
        );
        Renderer.drawRect(COLOR_PANEL, rect.x, rect.y, rect.w, rect.h);
        // Contained per popover: one popover's render exception must not
        // abort the others, and the cause needs to land in gui-debug.log —
        // a half-painted frame can't be diagnosed from a screenshot.
        try {
            renderElement(
                p.content,
                rect.x,
                rect.y,
                rect.w,
                rect.h,
                mouseX,
                mouseY,
                true
            );
        } catch (err) {
            debugLogError(`popover '${p.key ?? p.id}' render`, err);
        }
    }
    // A tooltip queued by popover content has to paint on top of the popover
    // itself. The standalone postGuiRender tooltip pass isn't guaranteed to
    // run after this one (equal LOWEST priority, CT's tie order isn't stable),
    // so draw it here while we still own the GL state. The standalone pass then
    // finds nothing queued and covers only the no-popover (panel) case.
    if (hasDeferredTooltip()) drawDeferredTooltip();
    endHtswOverlayDraw();
}

export function initPopoverRendering(): void {
    if (renderInitialized) return;
    renderInitialized = true;
    register("postGuiRender", (mouseX: number, mouseY: number) => {
        drawPopovers(mcToOverlay(mouseX), mcToOverlay(mouseY));
    }).setPriority(OnTrigger.Priority.LOWEST);
}

// Dispatch a wheel event into the topmost popover under the cursor. Returns true if any
// popover absorbed the wheel (caller should cancel the underlying Forge event so MC's
// scroll/tab change is suppressed), false if the cursor isn't over any popover so the
// wheel can fall through to the panel beneath.
export function tryDispatchPopoverWheel(
    mouseX: number,
    mouseY: number,
    delta: number
): boolean {
    if (openPopovers.length === 0) return false;
    for (let i = openPopovers.length - 1; i >= 0; i--) {
        const p = openPopovers[i];
        const rect = computePopoverRect(p);
        if (!pointInRect(rect, mouseX, mouseY)) {
            // For modals the scrim absorbs interaction even outside the popover rect, so
            // wheel scroll shouldn't fall through to the panel beneath.
            if (p.placement === "modal") return true;
            continue;
        }
        const laid = layoutElement(p.content, rect.x, rect.y, rect.w, rect.h);
        dispatchWheel(laid, mouseX, mouseY, delta);
        return true;
    }
    // No popover under cursor; modals block fall-through anywhere on screen.
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].placement === "modal") return true;
    }
    return false;
}

// True when mouseX/mouseY is inside any open popover's rect — used to suppress hover on panels.
// Modals always return true (their scrim absorbs all hover anywhere on screen).
export function mouseIsOverPopover(mouseX: number, mouseY: number): boolean {
    for (let i = 0; i < openPopovers.length; i++) {
        if (openPopovers[i].placement === "modal") return true;
        const rect = computePopoverRect(openPopovers[i]);
        if (pointInRect(rect, mouseX, mouseY)) return true;
    }
    return false;
}
