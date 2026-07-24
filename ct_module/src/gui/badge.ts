/// <reference types="../../CTAutocomplete" />

import { getOverlayScreenW } from "./lib/overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./lib/overlayDraw";
import { getMinecraft } from "./lib/java";
import { debugLogError } from "./lib/debugLog";

export type BadgeProvider = () => { text: string; color: number } | null;

const providers: BadgeProvider[] = [];

const BG_COLOR = 0xee1a1e26 | 0;
const PADDING_X = 6;
const PADDING_Y = 4;
const BADGE_H = 10;
const SCREEN_MARGIN = 10;
const GAP = 4;

export function registerBadge(provider: BadgeProvider): void {
    providers.push(provider);
}

export function renderBadges(): void {
    let y = SCREEN_MARGIN;
    let drawing = false;
    try {
        for (const provider of providers) {
            const badge = provider();
            if (badge === null) continue;
            if (!drawing) {
                drawing = true;
                beginHtswOverlayDraw();
            }
            // Rhino rejects JS numbers above 2^31 for Java int parameters,
            // so ARGB colors must be forced into signed 32-bit range.
            const color = badge.color | 0;
            const textW = Renderer.getStringWidth(badge.text);
            const boxW = textW + PADDING_X * 2;
            const boxH = BADGE_H + PADDING_Y * 2;
            const x = getOverlayScreenW() - SCREEN_MARGIN - boxW;
            Renderer.drawRect(BG_COLOR, x, y, boxW, boxH);
            Renderer.drawRect(color, x, y, 2, boxH);
            getMinecraft().field_71466_p.func_175065_a(
                badge.text,
                x + PADDING_X,
                y + PADDING_Y + 1,
                color,
                true
            );
            y += boxH + GAP;
        }
    } catch (e) {
        debugLogError("renderBadges", e);
    } finally {
        if (drawing) endHtswOverlayDraw();
    }
}
