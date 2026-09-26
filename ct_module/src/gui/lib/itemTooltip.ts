/// <reference types="../../../CTAutocomplete" />

import {
    getMinecraft,
    javaArrayAt,
    javaArrayLength,
    javaType,
    runtimeString,
    type RuntimeString,
} from "./java";
import { getOverlayScreenW, getOverlayScreenH } from "./overlayScale";

// Vanilla's item hover tooltip (GuiScreen.renderToolTip in 1.8.9), drawn for
// GUI item icons so they hover like items in an inventory.

const BG = 0xf0100010 | 0;
const BORDER_TOP = 0x505000ff | 0;
const BORDER_BOTTOM = (((BORDER_TOP & 0xfefefe) >> 1) | (BORDER_TOP & 0xff000000)) | 0;

/**
 * The tooltip lines Minecraft shows for `stack`: name in its rarity color,
 * the rest gray, F3+H extras and mod-injected lines included. Empty when
 * there is no player to ask for them (the title screen).
 */
export function mcItemTooltipLines(stack: HtswMinecraftItemStack): string[] {
    const player = (Player as unknown as HtswPlayerClass).getPlayer();
    if (player === null || player === undefined) return [];
    const advanced = getMinecraft().field_71474_y?.field_82882_x === true;
    const raw = tooltipStrings(stack.func_82840_a(player, advanced));
    // EnumChatFormatting.toString() is its `§x` control code.
    const rarityColor = stack.func_77953_t().field_77937_e as RuntimeString | null | undefined;
    const rarity = runtimeString(rarityColor);
    const lines: string[] = [];
    for (let i = 0; i < raw.length; i++) {
        lines.push((i === 0 ? rarity : "§7") + raw[i]);
    }
    return lines;
}

// getTooltip is declared to return a java.util.List, but CT 1.8.9 hands it
// back as an Object[] (observed in-game: `.size()` doesn't exist on it).
// Read either shape.
function tooltipStrings(value: unknown): string[] {
    const out: string[] = [];
    const length = javaArrayLength(value);
    if (length >= 0) {
        for (let i = 0; i < length; i++) {
            out.push(runtimeString(javaArrayAt(value, i) as RuntimeString | null));
        }
        return out;
    }
    const list = value as { size(): number; get(index: number): RuntimeString | null };
    const size = list.size();
    for (let i = 0; i < size; i++) out.push(runtimeString(list.get(i)));
    return out;
}

let tessellator: HtswTessellatorClass | null = null;
let vertexFormats: HtswDefaultVertexFormatsClass | null = null;

// Gui.drawGradientRect, which is protected: a vertical top→bottom fade.
function gradientRect(
    left: number,
    top: number,
    right: number,
    bottom: number,
    topColor: number,
    bottomColor: number
): void {
    if (tessellator === null) tessellator = javaType("net.minecraft.client.renderer.Tessellator");
    if (vertexFormats === null) {
        vertexFormats = javaType("net.minecraft.client.renderer.vertex.DefaultVertexFormats");
    }
    const channel = (c: number, shift: number): number => ((c >> shift) & 0xff) / 255;
    const gl = javaType("net.minecraft.client.renderer.GlStateManager");
    gl.func_179090_x();
    gl.func_179147_l();
    gl.func_179118_c();
    gl.func_179120_a(770, 771, 1, 0);
    gl.func_179103_j(7425);
    // Restore in `finally`: a throw with texturing still off would leave every
    // later text and icon draw blank.
    try {
        const tess = tessellator.func_178181_a();
        const wr = tess.func_178180_c();
        wr.func_181668_a(7, vertexFormats.field_181706_f);
        const tr = channel(topColor, 16);
        const tg = channel(topColor, 8);
        const tb = channel(topColor, 0);
        const ta = channel(topColor, 24);
        const br = channel(bottomColor, 16);
        const bg = channel(bottomColor, 8);
        const bb = channel(bottomColor, 0);
        const ba = channel(bottomColor, 24);
        wr.func_181662_b(right, top, 0).func_181666_a(tr, tg, tb, ta).func_181675_d();
        wr.func_181662_b(left, top, 0).func_181666_a(tr, tg, tb, ta).func_181675_d();
        wr.func_181662_b(left, bottom, 0).func_181666_a(br, bg, bb, ba).func_181675_d();
        wr.func_181662_b(right, bottom, 0).func_181666_a(br, bg, bb, ba).func_181675_d();
        tess.func_78381_a();
    } finally {
        gl.func_179103_j(7424);
        gl.func_179084_k();
        gl.func_179141_d();
        gl.func_179098_w();
    }
}

/** Draw `lines` as a vanilla item tooltip next to the mouse. */
export function drawItemTooltip(lines: string[], mouseX: number, mouseY: number): void {
    if (lines.length === 0) return;
    const font = getMinecraft().field_71466_p;
    let w = 0;
    for (let i = 0; i < lines.length; i++) {
        w = Math.max(w, font.func_78256_a(lines[i]));
    }
    // The first line sits 2px further from the rest, as in vanilla.
    const h = lines.length > 1 ? 8 + 2 + (lines.length - 1) * 10 : 8;
    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    let x = mouseX + 12;
    let y = mouseY - 12;
    if (x + w > screenW) x -= 28 + w;
    if (y + h + 6 > screenH) y = screenH - h - 6;
    if (x < 4) x = 4;
    if (y < 4) y = 4;

    gradientRect(x - 3, y - 4, x + w + 3, y - 3, BG, BG);
    gradientRect(x - 3, y + h + 3, x + w + 3, y + h + 4, BG, BG);
    gradientRect(x - 3, y - 3, x + w + 3, y + h + 3, BG, BG);
    gradientRect(x - 4, y - 3, x - 3, y + h + 3, BG, BG);
    gradientRect(x + w + 3, y - 3, x + w + 4, y + h + 3, BG, BG);
    gradientRect(x - 3, y - 2, x - 2, y + h + 2, BORDER_TOP, BORDER_BOTTOM);
    gradientRect(x + w + 2, y - 2, x + w + 3, y + h + 2, BORDER_TOP, BORDER_BOTTOM);
    gradientRect(x - 3, y - 3, x + w + 3, y - 2, BORDER_TOP, BORDER_TOP);
    gradientRect(x - 3, y + h + 2, x + w + 3, y + h + 3, BORDER_BOTTOM, BORDER_BOTTOM);

    let lineY = y;
    for (let i = 0; i < lines.length; i++) {
        font.func_175065_a(lines[i], x, lineY, -1, true);
        lineY += i === 0 ? 12 : 10;
    }
}
