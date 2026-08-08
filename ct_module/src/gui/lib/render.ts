/// <reference types="../../../CTAutocomplete" />

import {
    Element,
    LaidOut,
    Rect,
    layoutElement,
    markUserScroll,
    pointInRect,
    getScrollState,
    setScrollTarget,
    SCROLLBAR_WIDTH,
} from "./layout";
import { extract } from "./extractable";
import { reportAnchorRect } from "./anchors";
import { debugLog, debugLogError, isGuiDebugArmed } from "./debugLog";
import { registerClickFlash, clickFlashAlpha } from "./clickFlash";
import { isInputFocused, setFocusedInput } from "./focus";
import { pushScissor, popScissor } from "./scissor";
import { getInputField } from "./inputState";
import { COLOR_PANEL, COLOR_PANEL_BORDER } from "./theme";
import { getOverlayScreenW, getOverlayScreenH } from "./overlayScale";
import { getIconImage, renderMcItem } from "./images";
import { getMinecraft, javaType } from "./java";

const Gui = javaType("net.minecraft.client.gui.Gui" as never) as unknown as {
    func_73734_a(
        left: number,
        top: number,
        right: number,
        bottom: number,
        color: number
    ): void;
};

export function fillRect(
    color: number,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    Gui.func_73734_a(
        Math.round(x),
        Math.round(y),
        Math.round(x + w),
        Math.round(y + h),
        color
    );
}

const scrollItemsMemo = new WeakMap<LaidOut[], LaidOut[]>();

function scrollItemsOf(laid: LaidOut[]): LaidOut[] {
    const cached = scrollItemsMemo.get(laid);
    if (cached !== undefined) return cached;
    const scrollItems = laid.filter((item) => item.element.kind === "scroll");
    scrollItemsMemo.set(laid, scrollItems);
    return scrollItems;
}

const COLOR_INPUT_BG = 0xff000000 | 0;
const COLOR_INPUT_BORDER = 0xff444444 | 0;
const COLOR_INPUT_BORDER_HOVER = 0xffa2a2a2 | 0;
const COLOR_INPUT_BORDER_FOCUS = 0xff67a7e8 | 0;
const COLOR_SCROLLBAR_TRACK = 0x40000000 | 0;
const COLOR_SCROLLBAR_THUMB = 0xff888888 | 0;
const COLOR_SCROLLBAR_THUMB_HOVER = 0xffaaaaaa | 0;
const COLOR_HORIZONTAL_SCROLL_EDGE_ACCENT = 0x9067a7e8 | 0;

const LINE_H = 8;

const ELLIPSIS = "...";

// Reaching the font renderer costs two Rhino->Java crossings (the Minecraft
// lookup, then the field read), and the text branch below needs it for every
// label on screen. Read it once per frame in `drawLaid` instead. Re-read each
// frame rather than cached for good: Minecraft is free to swap the font
// renderer out between frames, and one lookup per frame is already nothing.
let frameFontRenderer: HtswMinecraftFontRenderer;

// Shortens `text` with a trailing ellipsis so it fits within `maxW` overlay
// units. Returns the original string when it already fits. Used by `truncate`
// text elements so a grow-shrunk label clips cleanly instead of overflowing
// into the sibling that follows it.
// Memoized: this runs on the DRAW path for every truncated label every frame,
// and the binary search below costs ~log2(len) getStringWidth Java calls per
// invocation — a full tree of truncated file rows paid hundreds of font
// measurements per frame. Font metrics are fixed per string, so (width, text)
// fully determines the result.
const truncateCache = new Map<string, string>();

export function truncateCacheSize(): number {
    return truncateCache.size;
}

function truncateToWidth(text: string, maxW: number): string {
    const key = `${maxW}|${text}`;
    const cached = truncateCache.get(key);
    if (cached !== undefined) return cached;
    const out = truncateToWidthUncached(text, maxW);
    if (truncateCache.size >= 2048) truncateCache.clear();
    truncateCache.set(key, out);
    return out;
}

function truncateToWidthUncached(text: string, maxW: number): string {
    if (maxW <= 0) return "";
    if (Renderer.getStringWidth(text) <= maxW) return text;
    const ellW = Renderer.getStringWidth(ELLIPSIS);
    if (maxW <= ellW) return "";
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const w = Renderer.getStringWidth(text.substring(0, mid)) + ellW;
        if (w <= maxW) lo = mid;
        else hi = mid - 1;
    }
    if (lo <= 0) return "";
    return text.substring(0, lo) + ELLIPSIS;
}

// Per-renderElement-call hover-tooltip queue. Set inside renderItem when a text
// with a `tooltip` is hovered, then handed to `deferredTooltip` so the actual
// draw happens at postGuiRender — after MC paints the inventory slots, which
// would otherwise cover a chip drawn during the panel's guiRender pass.
// `inPlace` tooltips paint over the anchor itself (text aligned exactly on the
// original glyphs) instead of below it — used to reveal a truncated label's
// full text where it sits, spilling over the siblings to its right.
type QueuedTooltip = { text: string; color: number; anchor: Rect; inPlace?: boolean };
let queuedTooltip: QueuedTooltip | null = null;

function takeQueuedTooltip(): QueuedTooltip | null {
    const tooltip = queuedTooltip;
    queuedTooltip = null;
    return tooltip;
}

// The tooltip to paint this frame, drawn by the postGuiRender pass in overlay.ts
// (on top of everything, including popovers). Draw-then-clear there resets it
// every frame, so a non-null value never survives into the next frame.
let deferredTooltip: QueuedTooltip | null = null;

export function hasDeferredTooltip(): boolean {
    return deferredTooltip !== null;
}

export function drawDeferredTooltip(): void {
    if (deferredTooltip === null) return;
    const t = deferredTooltip;
    deferredTooltip = null;
    drawTooltip(t);
}

// deferredTooltip is sticky (only overwritten when a new tooltip is queued), so
// a frame that queues one but never draws it must drop it explicitly — otherwise
// it lingers and paints on a later frame for an element no longer hovered.
export function clearDeferredTooltip(): void {
    deferredTooltip = null;
}

export function renderElement(
    root: Element,
    x: number,
    y: number,
    w: number,
    h: number,
    mouseX: number,
    mouseY: number,
    interactive: boolean
): LaidOut[] {
    const laid = layoutElement(root, x, y, w, h);
    drawLaid(laid, root, mouseX, mouseY, interactive);
    return laid;
}

/**
 * Paint an already-laid-out tree. Split out from `renderElement` so panels can
 * cache the layout and re-issue only the draw on frames where nothing
 * structural changed (see `lib/dirty`). Hover, click-flash, tooltips and every
 * value/color closure resolve here from the live mouse + element refs, so they
 * stay correct even when the layout is reused across frames.
 */
export function drawLaid(
    laid: LaidOut[],
    root: Element,
    mouseX: number,
    mouseY: number,
    interactive: boolean
): void {
    frameFontRenderer = getMinecraft().field_71466_p;
    queuedTooltip = null;

    // A click here would be intercepted by the scrollbar thumb (it starts a drag) — suppress hover
    // on items underneath so visual feedback matches click propagation. Anywhere the click would
    // actually reach the element, hover lights up normally.
    const intercepted = getClickInterceptor(laid, mouseX, mouseY) !== null;

    // The scissor is managed HERE, not per item: consecutive items almost
    // always share one clip rect (their scroll viewport), and a per-item
    // push/pop cost 3-4 GL Java crossings each. The try/finally keeps the
    // scissor stack balanced when an item's draw throws.
    let activeClip: Rect | null = null;
    try {
        for (let i = 0; i < laid.length; i++) {
            const item = laid[i];
            if (item.element.kind === "container" && item.element.anchorKey !== undefined) {
                reportAnchorRect(item.element.anchorKey, item.rect);
            }
            if (item.element === root) continue; // root drawn by caller (panel bg) or skipped
            const clip = item.clipRect ?? null;
            if (clip !== null) {
                // Cull items fully outside their clip on the Y axis: the
                // scissor would erase every pixel anyway, but only after
                // paying the draw + scissor-switch cost (an unvirtualized
                // list like the chat scrollback draws its whole backlog).
                // Every draw starts at the rect origin and extends at most
                // max(rect.h, 16)px down (icons / mc items / text centering),
                // hence the 16px slop above. X is deliberately not culled:
                // grow text overflows its rect sideways by design.
                const r = item.rect;
                if (r.y >= clip.y + clip.h || r.y + r.h + 16 <= clip.y) continue;
            }
            if (!sameClip(clip, activeClip)) {
                if (activeClip !== null) popScissor();
                if (clip !== null) pushScissor(clip);
                activeClip = clip;
            }
            renderItem(item, mouseX, mouseY, interactive, intercepted);
        }
    } finally {
        if (activeClip !== null) popScissor();
    }

    // Scrollbars render last (on top of clipped content) — overlay style.
    const scrollItems = scrollItemsOf(laid);
    for (let i = 0; i < scrollItems.length; i++) {
        const item = scrollItems[i];
        if (item.element.kind !== "scroll") continue;
        renderScrollbar(item.element.id, mouseX, mouseY);
    }

    const tooltip = takeQueuedTooltip();
    if (tooltip !== null) deferredTooltip = tooltip;
}

function drawTooltip(t: QueuedTooltip): void {
    const padX = 3;
    const padY = 2;
    // Measure with a trailing space — the text is left-anchored, so without
    // it the last glyph sits flush against the tooltip's right edge.
    const tw = Renderer.getStringWidth(`${t.text} `);
    const w = tw + padX * 2;
    const h = LINE_H + padY * 2;
    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    let x;
    let y;
    if (t.inPlace) {
        // Text draws at x + padX / y + padY, so backing off by the padding puts
        // the revealed string exactly on top of the anchor's own glyphs.
        x = t.anchor.x - padX;
        y = t.anchor.y + Math.max(0, Math.floor((t.anchor.h - LINE_H) / 2)) - padY;
    } else {
        x = t.anchor.x;
        y = t.anchor.y + t.anchor.h + 2;
        if (y + h > screenH - 2) y = t.anchor.y - h - 2; // flip above
    }
    if (x + w > screenW - 2) x = screenW - 2 - w;
    if (x < 2) x = 2;
    fillRect(COLOR_PANEL_BORDER, x - 1, y - 1, w + 2, h + 2);
    fillRect(COLOR_PANEL, x, y, w, h);
    getMinecraft().field_71466_p.func_175065_a(
        t.text,
        x + padX,
        y + padY,
        t.color,
        false
    );
}

function queueTooltip(
    tooltip: string,
    tooltipColor: number | undefined,
    anchor: Rect
): void {
    if (tooltip.length === 0) return;
    queuedTooltip = {
        text: tooltip,
        color: tooltipColor !== undefined ? tooltipColor : 0xffffffff | 0,
        anchor,
    };
}

// Returns the rect at (mx,my) that would intercept a click before it reaches normal element
// dispatch — currently only the scrollbar THUMB does this. Hover suppression and click dispatch
// share this predicate so the two are always consistent: anywhere a click would still reach the
// underlying element (e.g. the empty part of a scrollbar track), hover also lights up.
function getClickInterceptor(
    laid: LaidOut[],
    mx: number,
    my: number
): { x: number; y: number; w: number; h: number } | null {
    const scrollItems = scrollItemsOf(laid);
    for (let i = 0; i < scrollItems.length; i++) {
        const item = scrollItems[i];
        if (item.element.kind !== "scroll") continue;
        const thumb = scrollbarThumbRect(item.element.id);
        if (thumb !== null && pointInRect(thumb, mx, my)) return thumb;
    }
    return null;
}

// Geometry of a vertical scroll's draggable thumb, or null when there is none
// (horizontal strip, or content fits). Single source for hover suppression,
// drag start, and the scrollbar render so the three can't drift apart.
function scrollbarThumbRect(id: string): Rect | null {
    const s = getScrollState(id);
    if (s.axis === "x") return null; // horizontal strip has no draggable thumb
    const v = s.viewportRect;
    if (s.contentLength <= v.h) return null; // not overflowing
    const thumbH = Math.max(8, Math.floor((v.h * v.h) / s.contentLength));
    const maxOffset = s.contentLength - v.h;
    const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
    return { x: v.x + v.w - SCROLLBAR_WIDTH, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
}

// Armed-only draw tracing for the gray-house hunt: one line per distinct
// (tint, position) house-icon draw per second. The tint identifies the
// widget (none = tab icon, faint gray = unbound bind button, green = bound
// markers) and the rect pins it on screen.
const houseDrawLoggedAt = new Map<string, number>();
function logHouseIconDraw(tint: number | undefined, r: Rect): void {
    const key = `${tint === undefined ? "none" : (tint >>> 0).toString(16)}@${Math.round(r.x)},${Math.round(r.y)}`;
    const now = Date.now();
    const last = houseDrawLoggedAt.get(key);
    if (last !== undefined && now - last < 1000) return;
    houseDrawLoggedAt.set(key, now);
    debugLog(`draw icon=house tint=${tint === undefined ? "none" : (tint >>> 0).toString(16)} at=${Math.round(r.x)},${Math.round(r.y)} size=${Math.round(r.w)}x${Math.round(r.h)}`);
}

function renderItem(
    item: LaidOut,
    mouseX: number,
    mouseY: number,
    interactive: boolean,
    intercepted: boolean
): void {
    const r = item.rect;
    const e = item.element;
    const clip = item.clipRect;
    const inClip =
        !clip ||
        (mouseX >= clip.x &&
            mouseX <= clip.x + clip.w &&
            mouseY >= clip.y &&
            mouseY <= clip.y + clip.h);
    const hovered =
        interactive &&
        inClip &&
        !intercepted &&
        mouseX >= r.x &&
        mouseX <= r.x + r.w &&
        mouseY >= r.y &&
        mouseY <= r.y + r.h;

    if (e.kind === "container") {
        const onClick = e.onClick;
        let disabled = false;
        let hoverBg: number | undefined;
        if (onClick) {
            disabled =
                e.disabled !== undefined &&
                (typeof e.disabled === "function" ? e.disabled() : e.disabled);
            if (hovered && !disabled) {
                hoverBg =
                    e.style.hoverBackground !== undefined
                        ? typeof e.style.hoverBackground === "function"
                            ? e.style.hoverBackground()
                            : e.style.hoverBackground
                        : undefined;
            }
        }
        const baseBg =
            e.style.background !== undefined
                ? typeof e.style.background === "function"
                    ? e.style.background()
                    : e.style.background
                : undefined;
        const bg = hovered && onClick && !disabled && hoverBg !== undefined ? hoverBg : baseBg;
        if (bg !== undefined) fillRect(bg, r.x, r.y, r.w, r.h);
        if (onClick && !disabled) {
            const fa = clickFlashAlpha(r);
            if (fa > 0) {
                const a = Math.round(fa * 255) & 0xff;
                fillRect(((a << 24) | 0xffffff) | 0, r.x, r.y, r.w, r.h);
            }
        }
        if (hovered && e.onHover) e.onHover(r, mouseX, mouseY);
        if (hovered && e.tooltip !== undefined) {
            queueTooltip(
                typeof e.tooltip === "function" ? e.tooltip() : e.tooltip,
                e.tooltipColor !== undefined
                    ? typeof e.tooltipColor === "function"
                        ? e.tooltipColor()
                        : e.tooltipColor
                    : undefined,
                r
            );
        }
    } else if (e.kind === "text") {
        const raw = typeof e.text === "function" ? e.text() : e.text;
        const text = e.truncate ? truncateToWidth(raw, r.w) : raw;
        const ty = r.y + Math.max(0, Math.floor((r.h - LINE_H) / 2));
        const color =
            e.color !== undefined
                ? typeof e.color === "function"
                    ? e.color()
                    : e.color
                : undefined;
        if (color !== undefined) {
            frameFontRenderer.func_175065_a(text, r.x, ty, color, false);
        } else {
            if (text.indexOf("&") === -1) {
                frameFontRenderer.func_175065_a(text, r.x, ty, 0xffffffff | 0, false);
            } else {
                Renderer.drawString(text, r.x, ty);
            }
        }
        if (e.underlineColor !== undefined) {
            const underlineColor =
                typeof e.underlineColor === "function"
                    ? e.underlineColor()
                    : e.underlineColor;
            if (underlineColor !== undefined) {
                fillRect(underlineColor, r.x, ty + LINE_H - 1, r.w, 1);
            }
        }
        if (hovered && e.tooltip !== undefined) {
            queueTooltip(
                typeof e.tooltip === "function" ? e.tooltip() : e.tooltip,
                e.tooltipColor !== undefined
                    ? typeof e.tooltipColor === "function"
                        ? e.tooltipColor()
                        : e.tooltipColor
                    : undefined,
                r
            );
        } else if (hovered && text !== raw) {
            // Truncated label with no explicit tooltip: reveal the full text in
            // place, in the label's own color.
            queuedTooltip = {
                text: raw,
                color: color !== undefined ? color : 0xffffffff | 0,
                anchor: r,
                inPlace: true,
            };
        }
    } else if (e.kind === "input") {
        const focused = isInputFocused(e.id);
        const value = typeof e.value === "function" ? e.value() : e.value;
        // Background + border drawn by us (GuiTextField's own background is disabled).
        fillRect(COLOR_INPUT_BG, r.x, r.y, r.w, r.h);
        const borderCol = focused
            ? COLOR_INPUT_BORDER_FOCUS
            : hovered
              ? COLOR_INPUT_BORDER_HOVER
              : COLOR_INPUT_BORDER;
        fillRect(borderCol, r.x, r.y, r.w, 1);
        fillRect(borderCol, r.x, r.y + r.h - 1, r.w, 1);
        fillRect(borderCol, r.x, r.y, 1, r.h);
        fillRect(borderCol, r.x + r.w - 1, r.y, 1, r.h);
        if (value.length === 0 && e.placeholder && !focused) {
            const ty = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            const visiblePlaceholder = truncateToWidth(e.placeholder, r.w - 8);
            const placeholder = `§r§8${visiblePlaceholder}`;
            if (e.placeholder.indexOf("&") === -1) {
                frameFontRenderer.func_175065_a(
                    placeholder,
                    r.x + 4,
                    ty,
                    0xffffffff | 0,
                    true
                );
            } else {
                Renderer.drawStringWithShadow(placeholder, r.x + 4, ty);
            }
        } else {
            // Inset the field so cursor/text don't paint over our 1px border.
            const innerY = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            const field = getInputField(e.id, r.x + 4, innerY, r.w - 8, LINE_H, value);
            field.func_146194_f(); // drawTextBox
        }
    } else if (e.kind === "scroll") {
        const bg =
            e.style.background !== undefined
                ? typeof e.style.background === "function"
                    ? e.style.background()
                    : e.style.background
                : undefined;
        if (bg !== undefined) fillRect(bg, r.x, r.y, r.w, r.h);
    } else if (e.kind === "image") {
        const bg =
            e.style.background !== undefined
                ? typeof e.style.background === "function"
                    ? e.style.background()
                    : e.style.background
                : undefined;
        if (bg !== undefined) fillRect(bg, r.x, r.y, r.w, r.h);
        const name = typeof e.name === "function" ? e.name() : e.name;
        const img = getIconImage(name);
        // The DOM lib's HTMLImageElement collides with CT's global `Image` class for `as Image`
        // typing — go through `unknown` so the cast lands on CT's runtime Image.
        if (img !== null) {
            const tint =
                e.color !== undefined
                    ? typeof e.color === "function"
                        ? e.color()
                        : e.color
                    : undefined;
            if (tint !== undefined) {
                const a = ((tint >>> 24) & 0xff) / 255;
                const rr = ((tint >>> 16) & 0xff) / 255;
                const gg = ((tint >>> 8) & 0xff) / 255;
                const bb = (tint & 0xff) / 255;
                // CT's drawImage only forces white when `colorized` is null;
                // colorize() sets it so the tint survives the draw. Do NOT reset
                // with colorize(1,1,1,1) afterward: that leaves `colorized`
                // non-null, and CT's drawRect/drawImage skip applying their own
                // color while `colorized` is set — the next button/row background
                // would paint white. drawImage ends with finishDraw(), which
                // nulls `colorized` for us, so untinted draws stay clean.
                Renderer.colorize(rr, gg, bb, a);
            }
            if (name === "house" && isGuiDebugArmed()) {
                logHouseIconDraw(tint, r);
            }
            try {
                Renderer.drawImage(img as unknown as Parameters<typeof Renderer.drawImage>[0], r.x, r.y, r.w, r.h);
            } catch (err) {
                // CT's drawImage can throw from image.getTexture() BEFORE its
                // finishDraw() runs — verified in CT 2.2.1 source. Left alone,
                // the exception aborts the whole render tree (everything after
                // this element doesn't paint) and leaves Renderer.colorized
                // set, which overrides EVERY later drawString/drawRect color
                // with garbage — the "everything gray, text gone" frame.
                // Contain it: clear the poison and skip just this icon.
                try {
                    Renderer.finishDraw();
                } catch (_e2) {
                    /* nothing else to do */
                }
                debugLogError(`drawImage icon '${name}'`, err);
            }
        }
        if (hovered && e.tooltip !== undefined) {
            queueTooltip(
                typeof e.tooltip === "function" ? e.tooltip() : e.tooltip,
                e.tooltipColor !== undefined
                    ? typeof e.tooltipColor === "function"
                        ? e.tooltipColor()
                        : e.tooltipColor
                    : undefined,
                r
            );
        }
    } else {
        renderMcItem(e.item, e.count, e.metadata, r.x, r.y);
    }
}

function sameClip(a: Rect | null, b: Rect | null): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function renderScrollbar(id: string, mouseX: number, mouseY: number): void {
    renderHorizontalScrollEdges(id);
    const thumb = scrollbarThumbRect(id);
    if (thumb === null) return;
    const v = getScrollState(id).viewportRect;
    fillRect(COLOR_SCROLLBAR_TRACK, thumb.x, v.y, SCROLLBAR_WIDTH, v.h);
    const hovered = pointInRect(thumb, mouseX, mouseY);
    fillRect(
        hovered ? COLOR_SCROLLBAR_THUMB_HOVER : COLOR_SCROLLBAR_THUMB,
        thumb.x,
        thumb.y,
        thumb.w,
        thumb.h
    );
}

function renderHorizontalScrollEdges(id: string): void {
    const s = getScrollState(id);
    if (s.axis !== "x") return;
    const v = s.viewportRect;
    const maxOffset = Math.max(0, s.contentLength - v.w);
    if (maxOffset <= 0) return;
    if (s.offset > 0) {
        renderHorizontalScrollEdgeLine(v.x, v);
    }
    if (s.offset < maxOffset) {
        renderHorizontalScrollEdgeLine(v.x + v.w - 1, v);
    }
}

function renderHorizontalScrollEdgeLine(x: number, v: Rect): void {
    fillRect(COLOR_HORIZONTAL_SCROLL_EDGE_ACCENT, x, v.y, 1, v.h);
}
// Returns "consumed" if a clickable was hit, "miss" otherwise.
// Also handles input focusing and scrollbar drag start. `button` is the LWJGL mouse button
// (0 = left, 1 = right, 2 = middle); only left clicks engage scrollbar drag and double-click logic.
export function dispatchClick(
    laid: LaidOut[],
    mouseX: number,
    mouseY: number,
    button: number
): boolean {
    // Scrollbar thumb drag start uses the same interceptor predicate as hover suppression so the
    // two stay consistent. We still need the scroll id to start the drag, so look it up here.
    if (button === 0) {
        for (let i = 0; i < laid.length; i++) {
            const item = laid[i];
            if (item.element.kind !== "scroll") continue;
            const thumb = scrollbarThumbRect(item.element.id);
            if (thumb === null || !pointInRect(thumb, mouseX, mouseY)) continue;
            // A locked scroll consumes the click without moving, same as wheel.
            if (item.element.locked === undefined || !extract(item.element.locked)) {
                startScrollbarDrag(item.element.id, mouseY);
            }
            return true;
        }
    }

    // Topmost-first: walk in reverse.
    for (let i = laid.length - 1; i >= 0; i--) {
        const item = laid[i];
        if (item.clipRect && !pointInRect(item.clipRect, mouseX, mouseY)) continue;
        if (!pointInRect(item.rect, mouseX, mouseY)) continue;
        const e = item.element;
        if (e.kind === "container" && (e.onClick || e.onDoubleClick)) {
            setFocusedInput(null);
            if (e.disabled !== undefined && extract(e.disabled)) return true;
            if (e.onClick && !e.noClickFlash) registerClickFlash(item.rect);
            const isDouble =
                button === 0 && consumeDoubleClick(item.rect, mouseX, mouseY);
            if (e.onClick) e.onClick(item.rect, { button, x: mouseX, y: mouseY, isDoubleClickSecond: isDouble });
            if (isDouble && e.onDoubleClick) e.onDoubleClick(item.rect);
            return true;
        }
        if (e.kind === "input") {
            if (button !== 0) {
                setFocusedInput(null);
                return true;
            }
            setFocusedInput(e.id);
            // Forward click to the GuiTextField for cursor placement / drag-select start.
            // The field must already be marked focused for mouseClicked to set the cursor.
            const rec = getInputField(
                e.id,
                item.rect.x + 4,
                item.rect.y,
                item.rect.w - 8,
                item.rect.h,
                extract(e.value)
            );
            rec.func_146195_b(true); // setFocused
            rec.func_146192_a(mouseX, mouseY, 0); // mouseClicked
            return true;
        }
    }
    // Click landed on the panel but didn't hit anything clickable — still drop focus,
    // matching the behavior of clicking outside the panel entirely.
    setFocusedInput(null);
    return false;
}

// --- Double-click detection ---
// Two clicks count as a double-click if they happen within DOUBLE_CLICK_MS and the second
// click's position lies within the first click's rect. Resets after a double so triple-clicks
// don't chain into a second double.
const DOUBLE_CLICK_MS = 350;
let lastClickRect: Rect | null = null;
let lastClickTime = 0;

function consumeDoubleClick(rect: Rect, mouseX: number, mouseY: number): boolean {
    const now = Date.now();
    const isDouble =
        lastClickRect !== null &&
        now - lastClickTime < DOUBLE_CLICK_MS &&
        pointInRect(lastClickRect, mouseX, mouseY);
    if (isDouble) {
        lastClickRect = null;
        lastClickTime = 0;
    } else {
        lastClickRect = rect;
        lastClickTime = now;
    }
    return isDouble;
}

// --- Scrollbar drag state ---
let dragScrollId: string | null = null;
let dragStartMouseY = 0;
let dragStartOffset = 0;

function startScrollbarDrag(id: string, mouseY: number): void {
    dragScrollId = id;
    dragStartMouseY = mouseY;
    dragStartOffset = getScrollState(id).offset;
}

export function isDraggingScrollbar(): boolean {
    return dragScrollId !== null;
}

export function updateScrollbarDrag(mouseY: number): void {
    if (dragScrollId === null) return;
    const s = getScrollState(dragScrollId);
    if (s.contentLength <= s.viewportRect.h) {
        dragScrollId = null;
        return;
    }
    const v = s.viewportRect;
    const thumbH = Math.max(8, Math.floor((v.h * v.h) / s.contentLength));
    const trackPx = v.h - thumbH;
    if (trackPx <= 0) return;
    const dy = mouseY - dragStartMouseY;
    const maxOffset = s.contentLength - v.h;
    // Dragging the thumb is a direct 1:1 grab — set both so it tracks the
    // cursor instantly rather than easing behind it.
    const pos = Math.max(
        0,
        Math.min(maxOffset, dragStartOffset + Math.floor(dy * (maxOffset / trackPx)))
    );
    s.offset = pos;
    s.target = pos;
    if (dy !== 0) markUserScroll(dragScrollId);
}

export function endScrollbarDrag(): void {
    dragScrollId = null;
}

// --- Wheel scroll dispatch: find topmost scroll under cursor, scroll it ---
// Overlay units per wheel notch. Rows are SIZE_ROW_H (18), so 3 rows per
// notch — VS Code's default of 3 lines. `delta` is in notches and carries the
// real event magnitude (fractional for high-res wheels, >1 for fast flicks
// that coalesce into one event), so travel stays proportional to input.
const WHEEL_SCROLL_STEP = 54;

export function dispatchWheel(
    laid: LaidOut[],
    mouseX: number,
    mouseY: number,
    delta: number
): boolean {
    for (let i = laid.length - 1; i >= 0; i--) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        const s = getScrollState(item.element.id);
        if (!pointInRect(s.viewportRect, mouseX, mouseY)) continue;
        // A locked scroll consumes the wheel without moving the viewport
        // (e.g. the live-import code view while autoFollow drives it).
        if (item.element.locked !== undefined && extract(item.element.locked)) return true;
        const mainView = s.axis === "x" ? s.viewportRect.w : s.viewportRect.h;
        if (s.contentLength <= mainView) return true;
        // Cap the per-notch step to half the viewport so a short scroll area
        // (e.g. the chat scrollback) doesn't jump more than its visible height
        // per notch; tall panels keep the full step.
        const step = Math.min(WHEEL_SCROLL_STEP, Math.max(16, mainView * 0.5));
        // Accumulate into the target (not the rendered offset) so rapid notches
        // stack; layoutScroll eases the offset toward it each frame.
        setScrollTarget(item.element.id, s.target - delta * step);
        markUserScroll(item.element.id);
        return true;
    }
    return false;
}
