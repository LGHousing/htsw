/// <reference types="../../CTAutocomplete" />

import { Element, LaidOut, Rect, layoutElement, pointInRect } from "./layout";
import { extract } from "./extractable";

const COLOR_PANEL = 0xf0242931 | 0;
const COLOR_BUTTON = 0xe02d333d | 0;
const COLOR_BUTTON_HOVER = 0xf03a4350 | 0;
const CHAR_W = 6;
const LINE_H = 8;

export class Panel {
    private x: number;
    private y: number;
    private width: number;
    private height: number;
    private root: Element;
    private shouldBeVisible: () => boolean;
    private layoutCache: LaidOut[] | null;
    private renderTrigger: Trigger | null;
    private clickTrigger: Trigger | null;

    constructor(
        x: number,
        y: number,
        width: number,
        height: number,
        root: Element,
        shouldBeVisible: () => boolean
    ) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.root = root;
        this.shouldBeVisible = shouldBeVisible;
        this.layoutCache = null;
        this.renderTrigger = null;
        this.clickTrigger = null;
    }

    public getX(): number { return this.x; }
    public getY(): number { return this.y; }
    public getWidth(): number { return this.width; }
    public getHeight(): number { return this.height; }

    public setX(v: number): void { this.x = v; this.layoutCache = null; }
    public setY(v: number): void { this.y = v; this.layoutCache = null; }
    public setWidth(v: number): void { this.width = v; this.layoutCache = null; }
    public setHeight(v: number): void { this.height = v; this.layoutCache = null; }
    public setRoot(root: Element): void { this.root = root; this.layoutCache = null; }
    public invalidate(): void { this.layoutCache = null; }

    private ensureLayout(): LaidOut[] {
        if (this.layoutCache === null) {
            this.layoutCache = layoutElement(this.root, this.x, this.y, this.width, this.height);
        }
        return this.layoutCache;
    }

    private renderTree(mouseX: number, mouseY: number): void {
        Renderer.drawRect(COLOR_PANEL, this.x, this.y, this.width, this.height);
        const laid = this.ensureLayout();
        // Pre-order: parents first, children paint on top.
        for (let i = 0; i < laid.length; i++) {
            const item = laid[i];
            const r = item.rect;
            if (item.element === this.root) continue; // panel bg already drawn
            if (item.element.kind === "container") {
                const bg = item.element.style.background;
                if (bg !== undefined) Renderer.drawRect(bg, r.x, r.y, r.w, r.h);
            } else {
                const hovered = pointInRect(r, mouseX, mouseY);
                Renderer.drawRect(hovered ? COLOR_BUTTON_HOVER : COLOR_BUTTON, r.x, r.y, r.w, r.h);
                const text = extract(item.element.text);
                const textWidth = text.length * CHAR_W;
                const tx = r.x + Math.max(2, Math.floor((r.w - textWidth) / 2));
                const ty = r.y + Math.max(2, Math.floor((r.h - LINE_H) / 2));
                Renderer.drawString(text, tx, ty);
            }
        }
    }

    private dispatchClick(mouseX: number, mouseY: number): boolean {
        const laid = this.ensureLayout();
        // Topmost-first hit test.
        for (let i = laid.length - 1; i >= 0; i--) {
            const item = laid[i];
            if (item.element.kind !== "button") continue;
            if (!pointInRect(item.rect, mouseX, mouseY)) continue;
            item.element.onClick();
            return true;
        }
        return false;
    }

    public register(): void {
        if (this.renderTrigger !== null) {
            throw new Error("Panel is already registered");
        }
        this.renderTrigger = register("guiRender", (x: number, y: number, _gui: MCTGuiScreen) => {
            if (!this.shouldBeVisible()) return;
            this.renderTree(x, y);
        });
        this.clickTrigger = register(
            "guiMouseClick",
            (
                x: number,
                y: number,
                _mouseButton: number,
                _gui: MCTGuiScreen,
                event: CancellableEvent
            ) => {
                if (!this.shouldBeVisible()) return;
                const panelRect: Rect = { x: this.x, y: this.y, w: this.width, h: this.height };
                if (!pointInRect(panelRect, x, y)) return;
                if (this.dispatchClick(x, y)) {
                    cancel(event);
                }
            }
        );
    }

    public deregister(): void {
        if (this.renderTrigger === null || this.clickTrigger === null) {
            throw new Error("Panel is not registered");
        }
        this.renderTrigger.unregister();
        this.clickTrigger.unregister();
        this.renderTrigger = null;
        this.clickTrigger = null;
    }
}
