/// <reference types="../../../CTAutocomplete" />

import {
    ContainerBounds,
    getContainerBounds,
    getOpenContainerBounds,
} from "./bounds";
import { getMinecraft, javaType } from "./java";

// The overlay renders at MC's current GUI scale, capped at `OVERLAY_SCALE_TARGET` (4) so a
// modded scale of 5+ doesn't make the overlay unusably large. The per-frame effective scale is
// `getEffectiveOverlayScale() = min(OVERLAY_SCALE_TARGET, mcScale)`; overlay-internal
// coordinates live in that space (1 unit = effective-overlay-scale real pixels). At the
// boundary with MC we convert to/from MC's current scaled-coord space, and the render path
// applies a GL scale transform so Renderer.* calls (which interpret coords in MC's scaled
// space) produce the correct real-pixel output.

const ScaledResolutionClass = javaType("net.minecraft.client.gui.ScaledResolution");

// Target overlay scale (real pixels per overlay unit) — the cap on how big we'll render. The
// actual per-frame scale is `getEffectiveOverlayScale()`, which is MC's current scale capped at
// this target. We never render bigger than MC's own GUI; we only render smaller when a modded
// MC scale exceeds our cap.
const OVERLAY_SCALE_TARGET = 4;
let cachedMcScale = 0;
let cachedMcScaleRealW = -1;
let cachedMcScaleRealH = -1;
let cachedMcScaleAt = 0;

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
    const mc = getMinecraft();
    const realW = mc.field_71443_c;
    const realH = mc.field_71440_d;
    const now = Date.now();
    if (
        realW === cachedMcScaleRealW &&
        realH === cachedMcScaleRealH &&
        now - cachedMcScaleAt < 500
    ) {
        return cachedMcScale;
    }
    const sr = new ScaledResolutionClass(mc);
    const scaledW = sr.func_78326_a();
    if (typeof scaledW === "number" && scaledW > 0) {
        cachedMcScale = realW / scaledW;
    } else {
        cachedMcScale = sr.func_78325_e();
    }
    cachedMcScaleRealW = realW;
    cachedMcScaleRealH = realH;
    cachedMcScaleAt = now;
    return cachedMcScale;
}

// Convert a coord/length from MC's current scaled-coord space to overlay space (1 overlay unit
// = effective overlay scale real pixels). Equivalent to realPixels / effectiveOverlayScale.
export function mcToOverlay(coord: number): number {
    return Math.floor((coord * getMcScale()) / getEffectiveOverlayScale());
}

// Overlay-space screen dimensions (= real pixels / effective overlay scale).
export function getOverlayScreenW(): number {
    const dw = getMinecraft().field_71443_c;
    return Math.floor(dw / getEffectiveOverlayScale());
}

export function getOverlayScreenH(): number {
    const dh = getMinecraft().field_71440_d;
    return Math.floor(dh / getEffectiveOverlayScale());
}
// Same as `getContainerBounds` from `bounds.ts`, but with every field converted into overlay
// coords. Use this for layout / panel positioning; use the bounds.ts version when you need raw
// MC coords (e.g. forwarding to a Java API that expects them).
function toOverlayBounds(b: ContainerBounds | null): ContainerBounds | null {
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

export function getContainerBoundsOverlay(): ContainerBounds | null {
    return toOverlayBounds(getContainerBounds());
}

export function getOpenContainerBoundsOverlay(): ContainerBounds | null {
    return toOverlayBounds(getOpenContainerBounds());
}
