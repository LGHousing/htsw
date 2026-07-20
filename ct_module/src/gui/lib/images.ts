/// <reference types="../../../CTAutocomplete" />

import { GL11, getMinecraft, javaType } from "./java";

const RenderHelper = javaType("net.minecraft.client.renderer.RenderHelper");
const GlStateManager = javaType("net.minecraft.client.renderer.GlStateManager");
const ItemClass = javaType("net.minecraft.item.Item");

const ItemStackClass = javaType("net.minecraft.item.ItemStack");
const mcItemCache: { [key: string]: HtswMinecraftItemStack | null } = {};

function getCachedItemStack(
    itemId: string,
    count: number,
    metadata: number
): HtswMinecraftItemStack | null {
    const key = itemId + ":" + count + ":" + metadata;
    if (key in mcItemCache) return mcItemCache[key];
    try {
        const id = itemId.indexOf(":") >= 0 ? itemId : "minecraft:" + itemId;
        const item = ItemClass.func_111206_d(id);
        if (item === null) {
            mcItemCache[key] = null;
            return null;
        }
        const stack = new ItemStackClass(item, count, metadata);
        mcItemCache[key] = stack;
        return stack;
    } catch (_e) {
        mcItemCache[key] = null;
        return null;
    }
}

export function renderMcItem(
    itemId: string,
    count: number,
    metadata: number,
    x: number,
    y: number
): void {
    const stack = getCachedItemStack(itemId, count, metadata);
    if (stack === null) return;
    try {
        const mc = getMinecraft();
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
export function getIconImage(name: string): unknown {
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

// The preload below DECODES the PNGs, but CT uploads an Image's GL texture
// on its first actual draw — so an icon's first on-screen frame can render
// as an untextured gray box. Drawing each cached icon once, far offscreen,
// pays that upload up front. Called from the panel paint path (needs a GL
// context) every frame, but only acts on icons it hasn't warmed yet — the
// preload fills the cache asynchronously, so a one-shot warm would miss
// icons that finish loading after the first paint.
const warmedIcons = new Set<string>();
export function warmIconTextures(): void {
    for (const name in iconCache) {
        if (warmedIcons.has(name)) continue;
        warmedIcons.add(name);
        const img = iconCache[name];
        if (img !== null && img !== undefined) {
            try {
                Renderer.drawImage(img as never, -1000, -1000, 1, 1);
            } catch (_e) {
                // A failed warm means that icon pays on first draw; clear any
                // half-applied draw state so the failure can't leak.
                try { Renderer.finishDraw(); } catch (_e2) { /* ignore */ }
            }
        }
    }
}
