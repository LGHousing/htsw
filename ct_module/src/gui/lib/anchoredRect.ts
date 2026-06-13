import type { Rect } from "./layout";

export function placeAnchoredRect(
    anchor: Rect,
    width: number,
    height: number,
    screenWidth: number,
    screenHeight: number,
    align: "right" | "left" = "right"
): Rect {
    const w = Math.min(width, Math.max(0, screenWidth - 4));
    const h = Math.min(height, Math.max(0, screenHeight - 4));
    let x = align === "right" ? anchor.x + anchor.w - w : anchor.x;
    let y = anchor.y + anchor.h + 2;
    if (y + h > screenHeight - 2) y = anchor.y - h - 2;
    if (x + w > screenWidth - 2) x = screenWidth - 2 - w;
    if (x < 2) x = 2;
    if (y < 2) y = 2;
    if (y + h > screenHeight - 2) y = screenHeight - 2 - h;
    return { x, y, w, h };
}
