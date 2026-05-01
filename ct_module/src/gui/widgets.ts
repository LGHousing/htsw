import { Colors } from "./colors";

export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type TextField = {
    id: string;
    label: string;
    value: string;
    rect: Rect;
};

export function contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function drawPanel(rect: Rect): void {
    Renderer.drawRect(Colors.panel, rect.x, rect.y, rect.w, rect.h);
}

export function drawButton(
    gui: Gui,
    rect: Rect,
    label: string,
    enabled: boolean = true
): void {
    Renderer.drawRect(enabled ? Colors.panelSoft : 0x88505050, rect.x, rect.y, rect.w, rect.h);
    Renderer.drawRect(Colors.border, rect.x, rect.y, rect.w, 1);
    gui.drawString(label, rect.x + 6, rect.y + 6, enabled ? Colors.text : Colors.muted);
}

export function drawToggle(gui: Gui, rect: Rect, label: string, on: boolean): void {
    Renderer.drawRect(on ? 0xaa36512d : Colors.panelSoft, rect.x, rect.y, rect.w, rect.h);
    gui.drawString(`${on ? "[x]" : "[ ]"} ${label}`, rect.x + 6, rect.y + 6, on ? Colors.accent : Colors.text);
}

export function drawTextField(
    gui: Gui,
    field: TextField,
    focused: boolean
): void {
    Renderer.drawRect(focused ? 0xcc273348 : Colors.panelSoft, field.rect.x, field.rect.y, field.rect.w, field.rect.h);
    Renderer.drawRect(focused ? Colors.blue : Colors.border, field.rect.x, field.rect.y, field.rect.w, 1);
    gui.drawString(field.label, field.rect.x + 5, field.rect.y + 4, Colors.muted);
    gui.drawString(trimMiddle(field.value, Math.max(8, Math.floor(field.rect.w / 6))), field.rect.x + 5, field.rect.y + 14, Colors.text);
}

export function shortHash(hash: string | undefined): string {
    if (!hash) return "-";
    return hash.length <= 10 ? hash : hash.slice(0, 10);
}

export function trimText(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    if (maxChars <= 3) return value.slice(0, maxChars);
    return value.slice(0, maxChars - 3) + "...";
}

function trimMiddle(value: string, maxChars: number): string {
    if (value.length <= maxChars) return value;
    if (maxChars <= 5) return trimText(value, maxChars);
    const start = Math.ceil((maxChars - 3) / 2);
    const end = Math.floor((maxChars - 3) / 2);
    return value.slice(0, start) + "..." + value.slice(value.length - end);
}
