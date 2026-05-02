/// <reference types="../../CTAutocomplete" />

// @ts-ignore
const GuiClass = net.minecraft.client.gui.Gui;

// Minecraft inventory bevel palette (ARGB with 0xFF alpha).
const COLOR_BORDER = 0xFF000000 | 0;
const COLOR_LIGHT = 0xFFFFFFFF | 0;
const COLOR_DARK = 0xFF555555 | 0;
const COLOR_BODY = 0xFFFFFFFF | 0;

function fillRect(left: number, top: number, right: number, bottom: number, color: number): void {
    if (right <= left || bottom <= top) return;
    GuiClass.func_73734_a(left, top, right, bottom, color);
}

export class Panel {
    private x: number;
    private y: number;
    private width: number;
    private height: number;
    private shouldBeVisible: () => boolean;
    private trigger: Trigger | null;

    constructor(width: number, height: number, shouldBeVisible: () => boolean) {
        this.x = 0;
        this.y = 0;
        this.width = width;
        this.height = height;
        this.shouldBeVisible = shouldBeVisible;
        this.trigger = null;
    }

    public getX(): number { return this.x; }
    public getY(): number { return this.y; }
    public getWidth(): number { return this.width; }
    public getHeight(): number { return this.height; }

    public setX(x: number): void { this.x = x; }
    public setY(y: number): void { this.y = y; }
    public setWidth(width: number): void { this.width = width; }
    public setHeight(height: number): void { this.height = height; }

    public render(): void {
        const x = this.x;
        const y = this.y;
        const w = this.width;
        const h = this.height;
        if (w < 4 || h < 4) return;

        // Outer 1px black border.
        fillRect(x, y, x + w, y + 1, COLOR_BORDER);
        fillRect(x, y + h - 1, x + w, y + h, COLOR_BORDER);
        fillRect(x, y, x + 1, y + h, COLOR_BORDER);
        fillRect(x + w - 1, y, x + w, y + h, COLOR_BORDER);

        // Body fill.
        fillRect(x + 1, y + 1, x + w - 1, y + h - 1, COLOR_BODY);

        // Top + left highlight (1px inside the border).
        fillRect(x + 1, y + 1, x + w - 2, y + 2, COLOR_LIGHT);
        fillRect(x + 1, y + 1, x + 2, y + h - 2, COLOR_LIGHT);

        // Bottom + right shadow (1px inside the border).
        fillRect(x + 2, y + h - 2, x + w - 1, y + h - 1, COLOR_DARK);
        fillRect(x + w - 2, y + 2, x + w - 1, y + h - 1, COLOR_DARK);
    }

    public register(): void {
        if (this.trigger !== null) {
            throw new Error("Panel is already registered");
        }
        this.trigger = register("guiRender", () => {
            if (!this.shouldBeVisible()) return;
            this.render();
        });
    }

    public deregister(): void {
        if (this.trigger === null) {
            throw new Error("Panel is not registered");
        }
        this.trigger.unregister();
        this.trigger = null;
    }
}
