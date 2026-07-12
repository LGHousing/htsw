/// <reference types="../../../CTAutocomplete" />

import { Rect } from "./layout";

export const SCREEN_PAD = 4;

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

type ContainerFields = {
    left: any;
    top: any;
    xSize: any;
    ySize: any;
};

let containerFields: ContainerFields | null = null;

function resolveContainerFields(obj: any): ContainerFields | null {
    if (containerFields !== null) return containerFields;
    try {
        let klass = obj.getClass();
        while (klass !== null) {
            const declared = klass.getDeclaredFields();
            const found: { [name: string]: any } = {};
            for (let i = 0; i < declared.length; i++) {
                const field = declared[i];
                found[String(field.getName())] = field;
            }
            const left = found.field_147003_i;
            const top = found.field_147009_r;
            const xSize = found.field_146999_f;
            const ySize = found.field_147000_g;
            if (left && top && xSize && ySize) {
                left.setAccessible(true);
                top.setAccessible(true);
                xSize.setAccessible(true);
                ySize.setAccessible(true);
                containerFields = { left, top, xSize, ySize };
                return containerFields;
            }
            klass = klass.getSuperclass();
        }
    } catch (_e) {}
    return null;
}

function readIntField(obj: any, field: any): number | null {
    try {
        const value = field.get(obj);
        return typeof value === "number" ? value : null;
    } catch (_e) {
        return null;
    }
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

export function getOpenContainerBottomExtension(): number {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined) return 0;
    try {
        const name = String(gui.getClass().getName());
        return name.indexOf("GuiContainerCreative") >= 0 ? 28 : 0;
    } catch (_e) {
        return 0;
    }
}

function readOpenContainerBounds(): ContainerBounds | null {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined) return null;

    const screenW = gui.field_146294_l;
    const screenH = gui.field_146295_m;
    if (typeof screenW !== "number" || typeof screenH !== "number") return null;

    const fields = resolveContainerFields(gui);
    if (fields === null) return null;

    const left = readIntField(gui, fields.left);
    const top = readIntField(gui, fields.top);
    const xSize = readIntField(gui, fields.xSize);
    const ySize = readIntField(gui, fields.ySize);
    if (left === null || top === null || xSize === null || ySize === null) {
        return null;
    }
    return { screenW, screenH, left, top, xSize, ySize };
}

export function getOpenContainerBounds(): ContainerBounds | null {
    return readOpenContainerBounds();
}

export function getContainerBounds(): ContainerBounds | null {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined || isSuppressedScreen(gui)) return null;
    return readOpenContainerBounds();
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
