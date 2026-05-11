/// <reference types="../../CTAutocomplete" />

import { Rect } from "./layout";
import { ContainerBounds, getContainerBounds } from "./bounds";

// We always render the overlay as if MC's GUI scale were 4 ("Large"), regardless of the user's
// setting. All overlay-internal coordinates are in this fixed scale-4 space (1 unit = 4 real
// pixels). At the boundary with MC we convert to/from MC's current scaled-coord space, and the
// render path applies a GL scale transform so Renderer.* calls (which interpret coords in MC's
// scaled space) produce the correct real-pixel output.

// @ts-ignore
const ScaledResolutionClass = net.minecraft.client.gui.ScaledResolution;

// Target overlay scale (real pixels per overlay unit) — the cap on how big we'll render. The
// actual per-frame scale is `getEffectiveOverlayScale()`, which is MC's current scale capped at
// this target. We never render bigger than MC's own GUI; we only render smaller when a modded
// MC scale exceeds our cap.
export const OVERLAY_SCALE_TARGET = 4;

// Effective overlay scale this frame: MC's current real scale capped at OVERLAY_SCALE_TARGET.
// When MC is at-or-below the cap (the common case — vanilla maxes at 4), we match it exactly so
// the overlay tracks the user's chosen GUI Scale and doesn't tower over the inventory. When MC
// is above the cap (modded scale 5+), we stay at the target so the overlay doesn't become
// unusably large.
export function getEffectiveOverlayScale(): number {
    return Math.min(OVERLAY_SCALE_TARGET, getMcScale());
}

// MC's current effective scale factor (real pixels per scaled unit). We DON'T use
// `ScaledResolution.func_78325_e()` because vanilla 1.8.9 caps it at 4 — mods that add larger
// GUI scales (e.g. 5+) typically override `getScaledWidth/Height` but leave `scaleFactor`
// untouched, so the cached integer is wrong. Computing from realW / scaledW gives the actual
// effective ratio. The result can be non-integer if the mod uses fractional scales.
export function getMcScale(): number {
    const mc = Client.getMinecraft();
    const sr = new ScaledResolutionClass(mc);
    const realW = (mc as any).field_71443_c;
    const scaledW = sr.func_78326_a();
    if (typeof scaledW === "number" && scaledW > 0) {
        return realW / scaledW;
    }
    return sr.func_78325_e();
}

// Convert a coord/length from MC's current scaled-coord space to overlay space (1 overlay unit
// = effective overlay scale real pixels). Equivalent to realPixels / effectiveOverlayScale.
export function mcToOverlay(coord: number): number {
    return Math.floor((coord * getMcScale()) / getEffectiveOverlayScale());
}

// Overlay-space screen dimensions (= real pixels / effective overlay scale).
export function getOverlayScreenW(): number {
    const dw = (Client.getMinecraft() as any).field_71443_c;
    return Math.floor(dw / getEffectiveOverlayScale());
}

export function getOverlayScreenH(): number {
    const dh = (Client.getMinecraft() as any).field_71440_d;
    return Math.floor(dh / getEffectiveOverlayScale());
}

// Convert an MC scaled-coord rect into overlay coords.
export function mcRectToOverlay(r: Rect): Rect {
    return {
        x: mcToOverlay(r.x),
        y: mcToOverlay(r.y),
        w: mcToOverlay(r.w),
        h: mcToOverlay(r.h),
    };
}

// Same as `getContainerBounds` from `bounds.ts`, but with every field converted into overlay
// coords. Use this for layout / panel positioning; use the bounds.ts version when you need raw
// MC coords (e.g. forwarding to a Java API that expects them).
export function getContainerBoundsOverlay(): ContainerBounds | null {
    const b = getContainerBounds();
    if (b === null) return null;
    return {
        screenW: mcToOverlay(b.screenW),
        screenH: mcToOverlay(b.screenH),
        left: mcToOverlay(b.left),
        top: mcToOverlay(b.top),
        xSize: mcToOverlay(b.xSize),
        ySize: mcToOverlay(b.ySize),
    };
}
