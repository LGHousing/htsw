/// <reference types="../../CTAutocomplete" />

import {
    Element,
    LaidOut,
    Rect,
    layoutElement,
    markUserScroll,
    pointInRect,
    getScrollState,
    SCROLLBAR_WIDTH,
} from "./layout";
import { extract } from "./extractable";
import { registerClickFlash, clickFlashAlpha } from "./clickFlash";
import { isInputFocused, setFocusedInput } from "./focus";
import { pushScissor, popScissor } from "./scissor";
import { getInputField } from "./inputState";
import { COLOR_PANEL, COLOR_PANEL_BORDER } from "./theme";
import { getOverlayScreenW, getOverlayScreenH } from "./overlayScale";
import { GL11, javaType } from "./java";

const COLOR_INPUT_BG = 0xff000000 | 0;
const COLOR_INPUT_BORDER = 0xff444444 | 0;
const COLOR_INPUT_BORDER_HOVER = 0xffa2a2a2 | 0;
const COLOR_INPUT_BORDER_FOCUS = 0xff67a7e8 | 0;
const COLOR_SCROLLBAR_TRACK = 0x40000000 | 0;
const COLOR_SCROLLBAR_THUMB = 0xff888888 | 0;

const RenderHelper: any = javaType("net.minecraft.client.renderer.RenderHelper");
const GlStateManager: any = javaType("net.minecraft.client.renderer.GlStateManager");
const ItemClass: any = javaType("net.minecraft.item.Item");

const ItemStackClass: any = javaType("net.minecraft.item.ItemStack");
const mcItemCache: { [key: string]: any } = {};

function getCachedItemStack(itemId: string, count: number): any {
    const key = itemId + ":" + count;
    if (key in mcItemCache) return mcItemCache[key];
    try {
        const id = itemId.indexOf(":") >= 0 ? itemId : "minecraft:" + itemId;
        const item = ItemClass.func_111206_d(id);
        if (item === null || item === undefined) { mcItemCache[key] = null; return null; }
        const stack = new ItemStackClass(item, count);
        mcItemCache[key] = stack;
        return stack;
    } catch (_e) {
        mcItemCache[key] = null;
        return null;
    }
}

function renderMcItem(itemId: string, count: number, x: number, y: number): void {
    const stack = getCachedItemStack(itemId, count);
    if (stack === null) return;
    try {
        const mc = Client.getMinecraft();
        const ri = mc.func_175599_af();
        GlStateManager.func_179126_j();
        GL11.glDepthMask(true);
        RenderHelper.func_74520_c();
        ri.func_180450_b(stack, x, y);
        RenderHelper.func_74518_a();
        GlStateManager.func_179097_i();
        GL11.glDepthMask(false);
        GlStateManager.func_179131_c(1.0, 1.0, 1.0, 1.0);
    } catch (_e) {}
    if (count > 1) {
        const s = String(count);
        const fw = Renderer.getStringWidth(s);
        Renderer.drawStringWithShadow(s, x + 17 - fw, y + 9);
    }
}
const COLOR_SCROLLBAR_THUMB_HOVER = 0xffaaaaaa | 0;

const LINE_H = 8;

const ELLIPSIS = "...";

// Shortens `text` with a trailing ellipsis so it fits within `maxW` overlay
// units. Returns the original string when it already fits. Used by `truncate`
// text elements so a grow-shrunk label clips cleanly instead of overflowing
// into the sibling that follows it.
function truncateToWidth(text: string, maxW: number): string {
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
type QueuedTooltip = { text: string; color: number; anchor: Rect };
let queuedTooltip: QueuedTooltip | null = null;

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

// Icon (Image) cache. Loading reads from disk synchronously, so cache by name to pay
// the cost once. A failed load is cached as null so we don't retry every frame
// (and don't spam logs).
//
// We deliberately avoid `Image.fromAsset` / `Image.fromFile` — both are advertised by
// the CT autocomplete but other CT 1.8.9 modules (HTSL, HousingEditor) use the
// `new Image(javax.imageio.ImageIO.read(java.io.File(absPath)))` pattern instead,
// suggesting the convenience helpers don't work reliably in this CT build. Render
// path also uses Renderer.drawImage(img, x, y, w, h) instead of img.draw(...) for
// the same reason. We reach the Java APIs through Rhino's bare `java`/`javax`
// globals (matching HTSL); `Java.type(...)` was observed to hang CT 1.8.9 at module
// load time when invoked at top level.
// Flat under assets/ — CT 1.8.9 was observed to hang at /ct reload when this module's
// dir contained a nested subfolder (e.g. assets/icons/). Other working modules (HTSL,
// HousingEditor) keep all PNGs at the top level of assets/, so we match that layout.
const ICON_BASE_PATH = "./config/ChatTriggers/modules/HTSW/assets/";

declare const javax: { imageio: { ImageIO: { read: (f: unknown) => unknown } } };
declare const java: { io: { File: new (path: string) => unknown } };

const iconCache: { [name: string]: unknown } = {};
function getIconImage(name: string): unknown {
    if (Object.prototype.hasOwnProperty.call(iconCache, name)) {
        return iconCache[name];
    }
    let img: unknown = null;
    try {
        const buffered = javax.imageio.ImageIO.read(
            new java.io.File(ICON_BASE_PATH + name + ".png")
        );
        const ImageCtor = Image as unknown as new (b: unknown) => unknown;
        img = new ImageCtor(buffered);
    } catch (_e) {
        img = null;
    }
    iconCache[name] = img;
    return img;
}

export function backgroundPreloadIcons(): void {
    try {
        const FilesType = Java.type("java.nio.file.Files");
        const PathsType = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const dir = PathsType.get(ICON_BASE_PATH);
        // @ts-ignore
        if (!FilesType.exists(dir)) return;
        // @ts-ignore
        const stream = FilesType.newDirectoryStream(dir);
        const names: string[] = [];
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                const p = it.next();
                const filename = String(p.getFileName().toString());
                if (filename.length > 4 && filename.substring(filename.length - 4) === ".png") {
                    names.push(filename.substring(0, filename.length - 4));
                }
            }
        } finally {
            stream.close();
        }
        let i = 0;
        const loadNext = (): void => {
            if (i >= names.length) return;
            getIconImage(names[i]);
            i++;
            setTimeout(loadNext, 0);
        };
        setTimeout(loadNext, 0);
    } catch (_e) {
        // ignore
    }
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
    queuedTooltip = null;
    const laid = layoutElement(root, x, y, w, h);

    // A click here would be intercepted by the scrollbar thumb (it starts a drag) — suppress hover
    // on items underneath so visual feedback matches click propagation. Anywhere the click would
    // actually reach the element, hover lights up normally.
    const intercepted = getClickInterceptor(laid, mouseX, mouseY) !== null;

    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element === root) continue; // root drawn by caller (panel bg) or skipped
        renderItem(item, mouseX, mouseY, interactive, intercepted);
    }

    // Scrollbars render last (on top of clipped content) — overlay style.
    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        renderScrollbar(item.element.id, mouseX, mouseY);
    }

    if (queuedTooltip !== null) {
        deferredTooltip = queuedTooltip;
        queuedTooltip = null;
    }

    return laid;
}

function drawTooltip(t: QueuedTooltip): void {
    const padX = 3;
    const padY = 2;
    const tw = Renderer.getStringWidth(t.text);
    const w = tw + padX * 2;
    const h = LINE_H + padY * 2;
    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    let x = t.anchor.x;
    let y = t.anchor.y + t.anchor.h + 2;
    if (y + h > screenH - 2) y = t.anchor.y - h - 2; // flip above
    if (x + w > screenW - 2) x = screenW - 2 - w;
    if (x < 2) x = 2;
    Renderer.drawRect(COLOR_PANEL_BORDER, x - 1, y - 1, w + 2, h + 2);
    Renderer.drawRect(COLOR_PANEL, x, y, w, h);
    Client.getMinecraft().field_71466_p.func_175065_a(
        t.text,
        x + padX,
        y + padY,
        t.color,
        false
    );
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
    for (let i = 0; i < laid.length; i++) {
        const item = laid[i];
        if (item.element.kind !== "scroll") continue;
        const s = getScrollState(item.element.id);
        if (s.axis === "x") continue; // horizontal strip has no draggable thumb
        if (s.contentLength <= s.viewportRect.h) continue;
        const v = s.viewportRect;
        const trackX = v.x + v.w - SCROLLBAR_WIDTH;
        const thumbH = Math.max(8, Math.floor((v.h * v.h) / s.contentLength));
        const maxOffset = s.contentLength - v.h;
        const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
        const thumbRect = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
        if (pointInRect(thumbRect, mx, my)) return thumbRect;
    }
    return null;
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
    const inClip = !item.clipRect || pointInRect(item.clipRect, mouseX, mouseY);
    const hovered =
        interactive && inClip && !intercepted && pointInRect(r, mouseX, mouseY);

    if (item.clipRect) pushScissor(item.clipRect);

    if (e.kind === "container") {
        const hoverBg =
            e.style.hoverBackground !== undefined
                ? extract(e.style.hoverBackground)
                : undefined;
        const baseBg =
            e.style.background !== undefined ? extract(e.style.background) : undefined;
        const bg = hovered && e.onClick && hoverBg !== undefined ? hoverBg : baseBg;
        if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
        if (e.onClick) {
            const fa = clickFlashAlpha(r);
            if (fa > 0) {
                const a = Math.round(fa * 255) & 0xff;
                Renderer.drawRect(((a << 24) | 0xffffff) | 0, r.x, r.y, r.w, r.h);
            }
        }
        if (hovered && e.onHover) e.onHover(r);
    } else if (e.kind === "text") {
        const raw = extract(e.text);
        const text = e.truncate ? truncateToWidth(raw, r.w) : raw;
        const ty = r.y + Math.max(0, Math.floor((r.h - LINE_H) / 2));
        const color = e.color !== undefined ? extract(e.color) : undefined;
        if (color !== undefined) {
            Client.getMinecraft().field_71466_p.func_175065_a(
                text,
                r.x,
                ty,
                color,
                false
            );
        } else {
            Renderer.drawString(text, r.x, ty);
        }
        if (e.underlineColor !== undefined) {
            const underlineColor = extract(e.underlineColor);
            if (underlineColor !== undefined) {
                Renderer.drawRect(underlineColor, r.x, ty + LINE_H - 1, r.w, 1);
            }
        }
        if (hovered && e.tooltip !== undefined) {
            const tt = extract(e.tooltip);
            if (tt.length > 0) {
                const tc = e.tooltipColor !== undefined ? extract(e.tooltipColor) : 0xffffffff | 0;
                queuedTooltip = { text: tt, color: tc, anchor: r };
            }
        }
    } else if (e.kind === "input") {
        const focused = isInputFocused(e.id);
        const value = extract(e.value);
        // Background + border drawn by us (GuiTextField's own background is disabled).
        Renderer.drawRect(COLOR_INPUT_BG, r.x, r.y, r.w, r.h);
        const borderCol = focused
            ? COLOR_INPUT_BORDER_FOCUS
            : hovered
              ? COLOR_INPUT_BORDER_HOVER
              : COLOR_INPUT_BORDER;
        Renderer.drawRect(borderCol, r.x, r.y, r.w, 1);
        Renderer.drawRect(borderCol, r.x, r.y + r.h - 1, r.w, 1);
        Renderer.drawRect(borderCol, r.x, r.y, 1, r.h);
        Renderer.drawRect(borderCol, r.x + r.w - 1, r.y, 1, r.h);
        if (value.length === 0 && e.placeholder && !focused) {
            const ty = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            Renderer.drawStringWithShadow(`§r§8${e.placeholder}`, r.x + 4, ty);
        } else {
            // Inset the field so cursor/text don't paint over our 1px border.
            const innerY = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
            const field = getInputField(e.id, r.x + 4, innerY, r.w - 8, LINE_H, value);
            field.func_146194_f(); // drawTextBox
        }
    } else if (e.kind === "scroll") {
        const bg =
            e.style.background !== undefined ? extract(e.style.background) : undefined;
        if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
    } else if (e.kind === "image") {
        const bg =
            e.style.background !== undefined ? extract(e.style.background) : undefined;
        if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
        const name = extract(e.name);
        const img = getIconImage(name);
        // The DOM lib's HTMLImageElement collides with CT's global `Image` class for `as Image`
        // typing — go through `unknown` so the cast lands on CT's runtime Image.
        if (img !== null) {
            const tint = e.color !== undefined ? extract(e.color) : undefined;
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
            Renderer.drawImage(img as unknown as Parameters<typeof Renderer.drawImage>[0], r.x, r.y, r.w, r.h);
        }
        if (hovered && e.tooltip !== undefined) {
            const tt = extract(e.tooltip);
            if (tt.length > 0) {
                const tc = e.tooltipColor !== undefined ? extract(e.tooltipColor) : 0xffffffff | 0;
                queuedTooltip = { text: tt, color: tc, anchor: r };
            }
        }
    } else if (e.kind === "mcItem") {
        renderMcItem(e.item, e.count, r.x, r.y);
    }

    if (item.clipRect) popScissor();
}

function renderScrollbar(id: string, mouseX: number, mouseY: number): void {
    const s = getScrollState(id);
    const v = s.viewportRect;
    // Horizontal strips (e.g. the file-tab bar) scroll by wheel only — no
    // track or thumb is drawn.
    if (s.axis === "x") return;
    if (s.contentLength <= v.h) return; // not overflowing
    const trackX = v.x + v.w - SCROLLBAR_WIDTH;
    Renderer.drawRect(COLOR_SCROLLBAR_TRACK, trackX, v.y, SCROLLBAR_WIDTH, v.h);
    const thumbH = Math.max(8, Math.floor((v.h * v.h) / s.contentLength));
    const maxOffset = s.contentLength - v.h;
    const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
    const thumbRect = { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH };
    const hovered = pointInRect(thumbRect, mouseX, mouseY);
    Renderer.drawRect(
        hovered ? COLOR_SCROLLBAR_THUMB_HOVER : COLOR_SCROLLBAR_THUMB,
        thumbRect.x,
        thumbRect.y,
        thumbRect.w,
        thumbRect.h
    );
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
    if (button === 0 && getClickInterceptor(laid, mouseX, mouseY) !== null) {
        for (let i = 0; i < laid.length; i++) {
            const item = laid[i];
            if (item.element.kind !== "scroll") continue;
            const s = getScrollState(item.element.id);
            if (s.axis === "x") continue; // no draggable thumb on horizontal strips
            if (s.contentLength <= s.viewportRect.h) continue;
            const v = s.viewportRect;
            const trackX = v.x + v.w - SCROLLBAR_WIDTH;
            const thumbH = Math.max(8, Math.floor((v.h * v.h) / s.contentLength));
            const maxOffset = s.contentLength - v.h;
            const thumbY = v.y + Math.floor((v.h - thumbH) * (s.offset / maxOffset));
            if (
                pointInRect(
                    { x: trackX, y: thumbY, w: SCROLLBAR_WIDTH, h: thumbH },
                    mouseX,
                    mouseY
                )
            ) {
                startScrollbarDrag(item.element.id, mouseY);
                return true;
            }
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
            if (e.onClick) registerClickFlash(item.rect);
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
const DOUBLE_CLICK_MS = 200;
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
    s.offset = Math.max(
        0,
        Math.min(maxOffset, dragStartOffset + Math.floor(dy * (maxOffset / trackPx)))
    );
    if (dy !== 0) markUserScroll(dragScrollId);
}

export function endScrollbarDrag(): void {
    dragScrollId = null;
}

// --- Wheel scroll dispatch: find topmost scroll under cursor, scroll it ---
// Overlay units moved per wheel notch. Rows are SIZE_ROW_H (18), so ~5 rows.
const WHEEL_SCROLL_STEP = 90;

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
        const mainView = s.axis === "x" ? s.viewportRect.w : s.viewportRect.h;
        if (s.contentLength <= mainView) return true;
        s.offset = Math.max(
            0,
            Math.min(s.contentLength - mainView, s.offset - delta * WHEEL_SCROLL_STEP)
        );
        markUserScroll(item.element.id);
        return true;
    }
    return false;
}
