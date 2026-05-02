/// <reference types="../../CTAutocomplete" />

import { Button } from "./button";
import { Panel } from "./panel";

const SCREEN_PADDING = 4;
const PANEL_TO_CONTAINER_GAP = 6;
const BUTTON_INSET = 8;
const BUTTON_HEIGHT = 20;
const MIN_PANEL_WIDTH = 48;

let enabled = false;
let initialized = false;

let leftPanel: Panel | null = null;
let rightPanel: Panel | null = null;
let leftButton: Button | null = null;
let rightButton: Button | null = null;

let leftVisible = false;
let rightVisible = false;

let debugFramesLeft = 0;
function debug(msg: string): void {
    if (debugFramesLeft <= 0) return;
    ChatLib.chat(`&7[htsw-dbg] &f${msg}`);
}

interface ContainerBounds {
    screenWidth: number;
    screenHeight: number;
    left: number;
    top: number;
    xSize: number;
    ySize: number;
}

function getContainerBounds(): ContainerBounds | null {
    const gui = Client.getMinecraft().field_71462_r;
    if (gui === null || gui === undefined) {
        debug("no gui screen open");
        return null;
    }
    let className = "<unknown>";
    try {
        className = String(gui.getClass().getName());
    } catch (_e) {
        // ignore
    }
    // Duck-type GuiContainer: instanceof against Java classes is unreliable in
    // Rhino, so check for the obfuscated guiLeft/guiTop/xSize/ySize fields.
    const left = gui.field_147003_i;
    const top = gui.field_147009_r;
    const xSize = gui.field_146999_f;
    const ySize = gui.field_147000_g;
    const screenWidth = gui.field_146294_l;
    const screenHeight = gui.field_146295_m;
    debug(
        `gui=${className} left=${typeof left}:${left} top=${typeof top}:${top} ` +
            `xSize=${typeof xSize}:${xSize} ySize=${typeof ySize}:${ySize} ` +
            `sw=${typeof screenWidth}:${screenWidth} sh=${typeof screenHeight}:${screenHeight}`
    );
    if (
        typeof left !== "number" ||
        typeof top !== "number" ||
        typeof xSize !== "number" ||
        typeof ySize !== "number" ||
        typeof screenWidth !== "number" ||
        typeof screenHeight !== "number"
    ) {
        return null;
    }
    return { screenWidth, screenHeight, left, top, xSize, ySize };
}

function shouldOverlayBeActive(): boolean {
    return enabled && getContainerBounds() !== null;
}

function isLeftVisible(): boolean { return leftVisible; }
function isRightVisible(): boolean { return rightVisible; }

function updateLayout(): void {
    leftVisible = false;
    rightVisible = false;
    if (!enabled) return;
    const bounds = getContainerBounds();
    if (bounds === null) return;

    const panelHeight = Math.floor(bounds.screenHeight / 2);
    const panelY = Math.floor((bounds.screenHeight - panelHeight) / 2);

    const leftX = SCREEN_PADDING;
    const leftW = bounds.left - PANEL_TO_CONTAINER_GAP - leftX;
    if (leftW >= MIN_PANEL_WIDTH && leftPanel !== null && leftButton !== null) {
        leftVisible = true;
        leftPanel.setX(leftX);
        leftPanel.setY(panelY);
        leftPanel.setWidth(leftW);
        leftPanel.setHeight(panelHeight);

        const btnW = Math.max(20, leftW - BUTTON_INSET * 2);
        leftButton.setWidth(btnW);
        leftButton.setX(leftX + Math.floor((leftW - btnW) / 2));
        leftButton.setY(panelY + BUTTON_INSET);
    }

    const rightX = bounds.left + bounds.xSize + PANEL_TO_CONTAINER_GAP;
    const rightW = bounds.screenWidth - SCREEN_PADDING - rightX;
    if (rightW >= MIN_PANEL_WIDTH && rightPanel !== null && rightButton !== null) {
        rightVisible = true;
        rightPanel.setX(rightX);
        rightPanel.setY(panelY);
        rightPanel.setWidth(rightW);
        rightPanel.setHeight(panelHeight);

        const btnW = Math.max(20, rightW - BUTTON_INSET * 2);
        rightButton.setWidth(btnW);
        rightButton.setX(rightX + Math.floor((rightW - btnW) / 2));
        rightButton.setY(panelY + BUTTON_INSET);
    }
}

function ensureInitialized(): void {
    if (initialized) return;
    initialized = true;

    // Layout must run before Panel/Button render triggers, so register it first.
    register("guiRender", () => {
        debug(`guiRender fired enabled=${enabled}`);
        if (!shouldOverlayBeActive()) {
            leftVisible = false;
            rightVisible = false;
            if (debugFramesLeft > 0) debugFramesLeft--;
            return;
        }
        updateLayout();
        debug(
            `layout leftVisible=${leftVisible} rightVisible=${rightVisible} ` +
                `lp=(${leftPanel?.getX()},${leftPanel?.getY()},${leftPanel?.getWidth()}x${leftPanel?.getHeight()}) ` +
                `rp=(${rightPanel?.getX()},${rightPanel?.getY()},${rightPanel?.getWidth()}x${rightPanel?.getHeight()})`
        );
        if (debugFramesLeft > 0) debugFramesLeft--;
    });

    leftPanel = new Panel(MIN_PANEL_WIDTH, BUTTON_HEIGHT, isLeftVisible);
    rightPanel = new Panel(MIN_PANEL_WIDTH, BUTTON_HEIGHT, isRightVisible);
    leftPanel.register();
    rightPanel.register();

    leftButton = new Button(
        0,
        0,
        MIN_PANEL_WIDTH - BUTTON_INSET * 2,
        BUTTON_HEIGHT,
        "Left action",
        isLeftVisible,
        () => {
            ChatLib.chat("&a[htsw] left panel button clicked");
            return true;
        }
    );
    rightButton = new Button(
        0,
        0,
        MIN_PANEL_WIDTH - BUTTON_INSET * 2,
        BUTTON_HEIGHT,
        "Right action",
        isRightVisible,
        () => {
            ChatLib.chat("&a[htsw] right panel button clicked");
            return true;
        }
    );
    leftButton.register();
    rightButton.register();
}

export function toggleHtswGui(): boolean {
    ensureInitialized();
    enabled = !enabled;
    if (!enabled) {
        leftVisible = false;
        rightVisible = false;
    }
    return enabled;
}

export function armHtswGuiDebug(frames: number): void {
    ensureInitialized();
    debugFramesLeft = frames;
    ChatLib.chat(`&7[htsw-dbg] armed for ${frames} guiRender frames`);
}
