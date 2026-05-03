/// <reference types="../../../CTAutocomplete" />

import { Rect } from "./layout";

export const SCREEN_PAD = 4;
export const FRAME_GAP = 4;
export const TOP_BAR_H = 22;

export type ContainerBounds = {
    screenW: number;
    screenH: number;
    left: number;
    top: number;
    xSize: number;
    ySize: number;
};

// Field name reference (1.8.9 Forge MCP names, all on GuiContainer / GuiScreen):
//   field_71462_r  = Minecraft.currentScreen
//   field_146294_l = GuiScreen.width  (public)
//   field_146295_m = GuiScreen.height (public)
//   field_147003_i = GuiContainer.guiLeft (protected — needs reflection)
//   field_147009_r = GuiContainer.guiTop  (protected — needs reflection)
//   field_146999_f = GuiContainer.xSize   (protected — needs reflection)
//   field_147000_g = GuiContainer.ySize   (protected — needs reflection)

function readIntField(obj: any, fieldName: string): number | null {
    try {
        let klass = obj.getClass();
        while (klass !== null) {
            try {
                const field = klass.getDeclaredField(fieldName);
                field.setAccessible(true);
                const value = field.get(obj);
                if (typeof value === "number") return value;
                return null;
            } catch (_e) {
                klass = klass.getSuperclass();
            }
        }
    } catch (_e) {
        // ignore
    }
    return null;
}

// Screens that should NOT trigger our overlay — even though they're
// GuiContainers. The player inventory (E key) and the creative inventory
// are user-facing inventory UIs that the HTSW overlay has nothing to do
// with. Keep them clean.
//
// We compare by `Class.getName()` substring so the check survives both
// deobf names (`net.minecraft.client.gui.inventory.GuiInventory`) and
// obfuscated runtime names — the simple name suffix is the same in both.
function isSuppressedScreen(gui: any): boolean {
    try {
        const name = String(gui.getClass().getName());
        if (name.indexOf("GuiInventory") >= 0) return true;
        if (name.indexOf("GuiContainerCreative") >= 0) return true;
    } catch (_e) {
        // ignore
    }
    return false;
}

export function getContainerBounds(): ContainerBounds | null {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined) return null;

    if (isSuppressedScreen(gui)) return null;

    const screenW = gui.field_146294_l;
    const screenH = gui.field_146295_m;
    if (typeof screenW !== "number" || typeof screenH !== "number") return null;

    const left = readIntField(gui, "field_147003_i");
    const top = readIntField(gui, "field_147009_r");
    const xSize = readIntField(gui, "field_146999_f");
    const ySize = readIntField(gui, "field_147000_g");
    if (left === null || top === null || xSize === null || ySize === null) {
        return null;
    }
    return { screenW, screenH, left, top, xSize, ySize };
}

export function getFullscreenPanelRect(b: ContainerBounds): Rect {
    return {
        x: SCREEN_PAD,
        y: SCREEN_PAD,
        w: b.screenW - 2 * SCREEN_PAD,
        h: b.screenH - 2 * SCREEN_PAD,
    };
}

// Vanilla MC 1.8.9 chat default rect: 320×80 scaled px at the bottom-left,
// 2px gutter from edges, ~22px above hotbar (which we don't use here since
// the hotbar isn't visible while a GuiContainer is open — but match the
// usual bottom-anchor anyway). v1 uses fixed defaults; v2 can read
// gameSettings.chatScale/chatWidth/chatHeightFocused via reflection.
export function getChatBounds(b: ContainerBounds): Rect {
    return { x: 2, y: b.screenH - 82, w: 320, h: 80 };
}
