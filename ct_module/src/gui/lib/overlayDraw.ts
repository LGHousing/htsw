/// <reference types="../../../CTAutocomplete" />

import { getEffectiveOverlayScale, getMcScale } from "./overlayScale";
import { GL11, javaType } from "./java";

const RenderHelper: any = javaType("net.minecraft.client.renderer.RenderHelper");
const GlStateManager: any = javaType("net.minecraft.client.renderer.GlStateManager");

function resetGuiState(): void {
    try {
        GL11.glDisable(GL11.GL_SCISSOR_TEST);
    } catch (_e) {}
    try {
        RenderHelper.func_74518_a();
    } catch (_e) {
        try {
            RenderHelper.disableStandardItemLighting();
        } catch (_e2) {}
    }
    try {
        GlStateManager.func_179098_w();
    } catch (_e) {}
    try {
        GlStateManager.func_179140_f();
    } catch (_e) {}
    try {
        GlStateManager.func_179131_c(1.0, 1.0, 1.0, 1.0);
    } catch (_e) {}
    try {
        GlStateManager.func_179097_i();
    } catch (_e) {
        try {
            GL11.glDisable(GL11.GL_DEPTH_TEST);
        } catch (_e2) {}
    }
    try {
        GL11.glDepthMask(false);
    } catch (_e) {}
    try {
        GlStateManager.func_179147_l();
    } catch (_e) {
        try {
            GL11.glEnable(GL11.GL_BLEND);
        } catch (_e2) {}
    }
    try {
        GlStateManager.func_179120_a(770, 771, 1, 0);
    } catch (_e) {
        try {
            GL11.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA);
        } catch (_e2) {}
    }
}

export function beginHtswOverlayDraw(): void {
    resetGuiState();
    const f = getEffectiveOverlayScale() / getMcScale();
    GL11.glMatrixMode(GL11.GL_PROJECTION);
    GL11.glPushMatrix();
    GL11.glScalef(f, f, 1);
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glPushMatrix();
    GL11.glTranslated(0, 0, 1000);
}

export function endHtswOverlayDraw(): void {
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glPopMatrix();
    GL11.glMatrixMode(GL11.GL_PROJECTION);
    GL11.glPopMatrix();
    GL11.glMatrixMode(GL11.GL_MODELVIEW);
    GL11.glDepthMask(true);
}
