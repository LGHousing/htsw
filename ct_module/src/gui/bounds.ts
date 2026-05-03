/// <reference types="../../CTAutocomplete" />

import { Rect } from "./lib/layout";

const SCREEN_PAD = 4;
const CONTAINER_GAP = 6;
const MIN_PANEL_WIDTH = 24;
const PANEL_HEIGHT_FRACTION = 0.8;

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
//
// Rhino's property-access path only sees public fields, so we walk up the class
// hierarchy with getDeclaredField + setAccessible to read the protected ones.

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

export function getContainerBounds(): ContainerBounds | null {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined) return null;

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

export function leftPanelRect(b: ContainerBounds): Rect | null {
    const x = SCREEN_PAD;
    const w = b.left - CONTAINER_GAP - x;
    if (w < MIN_PANEL_WIDTH) return null;
    const h = Math.floor(b.screenH * PANEL_HEIGHT_FRACTION);
    return { x, y: SCREEN_PAD, w, h };
}

export function rightPanelRect(b: ContainerBounds): Rect | null {
    const x = b.left + b.xSize + CONTAINER_GAP;
    const w = b.screenW - SCREEN_PAD - x;
    if (w < MIN_PANEL_WIDTH) return null;
    const h = Math.floor(b.screenH * PANEL_HEIGHT_FRACTION);
    return { x, y: SCREEN_PAD, w, h };
}
