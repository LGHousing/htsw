/// <reference types="../../CTAutocomplete" />

import { getOverlayScreenW, getOverlayScreenH } from "./lib/overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./lib/overlayDraw";
import { getMinecraft } from "./lib/java";

type Toast = {
    key: string | null;
    message: string;
    color: number;
    shownAt: number;
    durationMs: number;
    fitText: string;
    fitWidth: number;
    fitScreenW: number;
};

let active: Toast | null = null;

const FADE_MS = 400;
const BG_COLOR = 0xee1a1e26 | 0;
const PADDING_X = 12;
const PADDING_Y = 6;
const TOAST_H = 14;
const SCREEN_MARGIN = 10;

export function showToast(
    message: string,
    color: number,
    durationMs: number = 4000,
    key: string | null = null
): void {
    active = {
        key,
        message: message.replace(/\s+/g, " ").trim(),
        color,
        shownAt: Date.now(),
        durationMs,
        fitText: "",
        fitWidth: 0,
        fitScreenW: -1,
    };
}

export function dismissToast(key: string): void {
    if (active !== null && active.key === key) active = null;
}

function fitToScreen(toast: Toast, screenW: number): void {
    if (toast.fitScreenW === screenW) return;
    toast.fitScreenW = screenW;
    const maxTextW = screenW - SCREEN_MARGIN * 2 - PADDING_X * 2;
    const fullW = Renderer.getStringWidth(toast.message);
    if (fullW <= maxTextW) {
        toast.fitText = toast.message;
        toast.fitWidth = fullW;
        return;
    }
    const ellipsis = "…";
    const budget = maxTextW - Renderer.getStringWidth(ellipsis);
    let width = 0;
    let end = 0;
    while (end < toast.message.length) {
        const charWidth = Renderer.getStringWidth(toast.message.charAt(end));
        if (width + charWidth > budget) break;
        width += charWidth;
        end++;
    }
    toast.fitText = toast.message.substring(0, end) + ellipsis;
    toast.fitWidth = Renderer.getStringWidth(toast.fitText);
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

    const screenW = getOverlayScreenW();
    const screenH = getOverlayScreenH();
    fitToScreen(active, screenW);
    const boxW = active.fitWidth + PADDING_X * 2;
    const boxH = TOAST_H + PADDING_Y * 2;
    const x = Math.floor((screenW - boxW) / 2);
    const y = Math.floor(screenH * 0.3 - boxH / 2);

    const bgAlpha = Math.round(0xee * alpha);
    const bg = ((bgAlpha << 24) | (BG_COLOR & 0x00ffffff)) | 0;

    const textAlpha = Math.round(0xff * alpha);
    const textColor = ((textAlpha << 24) | (active.color & 0x00ffffff)) | 0;

    beginHtswOverlayDraw();
    Renderer.drawRect(bg, x, y, boxW, boxH);
    getMinecraft().field_71466_p.func_175065_a(
        active.fitText,
        x + PADDING_X,
        y + PADDING_Y + 2,
        textColor,
        true
    );
    endHtswOverlayDraw();
}
