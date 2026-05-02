/// <reference types="../../CTAutocomplete" />

import { Rect, intersectRect } from "./layout";

// @ts-ignore
const GL11 = org.lwjgl.opengl.GL11;
// @ts-ignore
const ScaledResolutionClass = net.minecraft.client.gui.ScaledResolution;

const scissorStack: Rect[] = [];

export function pushScissor(rect: Rect): void {
    const effective = scissorStack.length === 0
        ? rect
        : intersectRect(scissorStack[scissorStack.length - 1], rect);
    scissorStack.push(effective);
    applyScissor(effective);
}

export function popScissor(): void {
    scissorStack.pop();
    if (scissorStack.length === 0) {
        GL11.glDisable(GL11.GL_SCISSOR_TEST);
    } else {
        applyScissor(scissorStack[scissorStack.length - 1]);
    }
}

function applyScissor(rect: Rect): void {
    const sr = new ScaledResolutionClass(Client.getMinecraft());
    const scale = sr.func_78325_e();
    const screenH = sr.func_78328_b();
    GL11.glEnable(GL11.GL_SCISSOR_TEST);
    GL11.glScissor(
        rect.x * scale,
        (screenH - rect.y - rect.h) * scale,
        rect.w * scale,
        rect.h * scale
    );
}
