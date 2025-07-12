/// <reference types="../../CTAutocomplete" />

// @ts-ignore
const MinecraftGuiButtonClass = net.minecraft.client.gui.GuiButton;

const MAX_HEIGHT = 20;

export class Button {
    private mcObject: typeof MinecraftGuiButtonClass;
    private shouldBeVisible: () => boolean;
    private onClick: () => boolean | void;
    private triggers: Trigger[];
    constructor(
        x: number,
        y: number,
        width: number,
        height: number,
        text: string | null,
        shouldBeVisible: () => boolean,
        onClick: () => boolean | void
    ) {
        if (width <= 0) {
            throw new Error('Width must be greater than 0');
        }
        if (height <= 0) {
            throw new Error('Height must be greater than 0');
        }
        if (height > MAX_HEIGHT) {
            throw new Error(`Height cannot exceed ${MAX_HEIGHT}`);
        }
        this.mcObject = new MinecraftGuiButtonClass(0, x, y, width, height, text);
        this.shouldBeVisible = shouldBeVisible;
        this.onClick = onClick;
        this.triggers = [];
        console.log(this.triggers.length);
    }

    public getX(): number {
        return this.mcObject.field_146128_h;
    }

    public setX(x: number) {
        this.mcObject.field_146128_h = x;
    }

    public getY(): number {
        return this.mcObject.field_146129_i;
    }

    public setY(y: number) {
        this.mcObject.field_146129_i = y;
    }

    public getWidth(): number {
        return this.mcObject.field_146120_f;
    }

    public setWidth(width: number) {
        if (width <= 0) {
            throw new Error('Width must be greater than 0');
        }
        this.mcObject.field_146120_f = width;
    }

    public getHeight(): number {
        return this.mcObject.field_146121_g;
    }

    public setHeight(height: number) {
        if (height <= 0) {
            throw new Error('Height must be greater than 0');
        }
        if (height >= MAX_HEIGHT) {
            throw new Error(`Height cannot exceed ${MAX_HEIGHT}`);
        }
        this.mcObject.field_146121_g = height;
    }

    public getText(): string | null {
        const textField = this.mcObject.class.getDeclaredField('field_146126_j');
        textField.setAccessible(true);
        return textField.get(this.mcObject);
    }

    public setText(text: string | null) {
        const textField = this.mcObject.class.getDeclaredField('field_146126_j');
        textField.setAccessible(true);
        textField.set(this.mcObject, text);
    }

    public isHovered(x: number, y: number): boolean {
        return (
            x >= this.getX() &&
            x <= this.getX() + this.getWidth() &&
            y >= this.getY() &&
            y <= this.getY() + this.getHeight()
        );
    }

    public render(x: number, y: number) {
        this.mcObject.func_146112_a(Client.getMinecraft(), x, y);
    }

    public register() {
        if (this.triggers.length > 0) {
            throw new Error('Button is already registered');
        }
        const guiRenderTrigger = register(
            'guiRender',
            (x: number, y: number, gui: MCTGuiScreen) => {
                if (!this.shouldBeVisible()) return;
                this.render(x, y);
            }
        );
        const guiMouseClickTrigger = register(
            'guiMouseClick',
            (
                x: number,
                y: number,
                mouseButton: number,
                gui: MCTGuiScreen,
                event: CancellableEvent
            ) => {
                if (!this.shouldBeVisible()) return;
                if (!this.isHovered(x, y)) return;
                const result = this.onClick();
                if (result) {
                    cancel(event);
                }
            }
        );
        this.triggers = [guiRenderTrigger, guiMouseClickTrigger];
    }

    public deregister() {
        if (this.triggers.length === 0) {
            throw new Error('Button is not registered');
        }
        for (const trigger of this.triggers) {
            trigger.unregister();
        }
        this.triggers = [];
    }
}
