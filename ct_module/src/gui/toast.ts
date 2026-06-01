/// <reference types="../../CTAutocomplete" />

import { getOverlayScreenW, getOverlayScreenH } from "./lib/overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./lib/panel";

type Toast = {
    message: string;
    color: number;
    shownAt: number;
    durationMs: number;
};

let active: Toast | null = null;

const FADE_MS = 400;
const BG_COLOR = 0xee1a1e26 | 0;
const PADDING_X = 12;
const PADDING_Y = 6;
const TOAST_H = 14;

export function showToast(message: string, color: number, durationMs: number = 4000): void {
    active = { message, color, shownAt: Date.now(), durationMs };
}

export function renderToast(): void {
    if (active === null) return;
    const elapsed = Date.now() - active.shownAt;
    if (elapsed > active.durationMs + FADE_MS) {
        active = null;
        return;
    }

    let alpha = 1;
    if (elapsed > active.durationMs) {
        alpha = 1 - (elapsed - active.durationMs) / FADE_MS;
    }
    if (alpha <= 0) {
        active = null;
        return;
    }

    const textW = Renderer.getStringWidth(active.message);
    const boxW = textW + PADDING_X * 2;
    const boxH = TOAST_H + PADDING_Y * 2;
    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    const x = Math.floor((screenW - boxW) / 2);
    const y = Math.floor(screenH * 0.3 - boxH / 2);

    const bgAlpha = Math.round(0xee * alpha);
    const bg = ((bgAlpha << 24) | (BG_COLOR & 0x00ffffff)) | 0;

    const textAlpha = Math.round(0xff * alpha);
    const textColor = ((textAlpha << 24) | (active.color & 0x00ffffff)) | 0;

    beginHtswOverlayDraw();
    Renderer.drawRect(bg, x, y, boxW, boxH);
    Client.getMinecraft().field_71466_p.func_175065_a(
        active.message,
        x + PADDING_X,
        y + PADDING_Y + 2,
        textColor,
        true
    );
    endHtswOverlayDraw();
}
