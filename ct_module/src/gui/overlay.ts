/// <reference types="../../CTAutocomplete" />

import { Panel } from "./panel";
import { Element, Rect, layoutElement, pointInRect, getScrollState } from "./layout";

// LWJGL globals not in CT autocomplete.
// @ts-ignore
const MouseClass = Java.type("org.lwjgl.input.Mouse");
// @ts-ignore
const KeyboardClass = Java.type("org.lwjgl.input.Keyboard");
// @ts-ignore
const ScaledResolutionClass = net.minecraft.client.gui.ScaledResolution;
// Forge inner-class path uses $ separators with Java.type.
// @ts-ignore
const ForgeMouseInputEventPre = Java.type(
    "net.minecraftforge.client.event.GuiScreenEvent$MouseInputEvent$Pre"
);
// @ts-ignore
const ForgeKeyboardInputEventPre = Java.type(
    "net.minecraftforge.client.event.GuiScreenEvent$KeyboardInputEvent$Pre"
);
import { RootTree } from "./root";
import { getContainerBounds, getFullscreenPanelRect } from "./bounds";
import { autoDiscoverImportJson, reparseImportJson, tickReparse } from "./reparse";
import { CHAT_INPUT_ID } from "./chat-input";

const KEY_T = 20; // LWJGL keycode for 'T'
import { initPopoverRendering, popoverIsOpen, closeAllPopovers } from "./popovers";
import {
    dispatchWheel,
    isDraggingScrollbar,
    updateScrollbarDrag,
    endScrollbarDrag,
    setRenderDebugLog,
} from "./render";
import { getFocusedInput, setFocusedInput } from "./focus";
import { applyFocus, getRecord, readAndSync, tickAllFields } from "./inputState";

let enabled = true;
let initialized = false;
let debugUntilMs = 0;

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
const DEBUG_LOG_PATH = "./config/ChatTriggers/modules/HTSW/gui-debug.log";
let debugBuffer = "";

function debugActive(): boolean {
    return Date.now() < debugUntilMs;
}

function debug(msg: string): void {
    if (!debugActive()) return;
    debugBuffer += `[${Date.now()}] ${msg}\n`;
    FileLib.write(DEBUG_LOG_PATH, debugBuffer);
}

export function debugLog(msg: string): void {
    debug(msg);
}
export function debugIsActive(): boolean {
    return debugActive();
}

function frameBounds(): Rect {
    const b = getContainerBounds();
    if (b === null) return ZERO_RECT;
    return getFullscreenPanelRect(b);
}

function frameVisible(): boolean {
    if (!enabled) return false;
    return getContainerBounds() !== null;
}

// Track active panels so global handlers (wheel, key) can locate the laid-out trees.
type ActivePanel = {
    panel: Panel;
    getBounds: () => Rect;
    getRoot: () => Element;
    isVisible: () => boolean;
};
const activePanels: ActivePanel[] = [];

function laidOutTrees(): { root: Element; rect: Rect }[] {
    const out: { root: Element; rect: Rect }[] = [];
    for (let i = 0; i < activePanels.length; i++) {
        if (!activePanels[i].isVisible()) continue;
        out.push({ root: activePanels[i].getRoot(), rect: activePanels[i].getBounds() });
    }
    return out;
}

export function initHtswGui(): void {
    if (initialized) return;
    initialized = true;

    setRenderDebugLog(debug);

    // Single fullscreen panel; the element tree (RootTree) wraps around the
    // container + chat cutouts. paintBackground=false because the tree paints
    // its own background regions, leaving cutouts naturally transparent.
    const frame = new Panel(frameBounds, RootTree(), frameVisible, false);
    frame.register();
    activePanels.push({
        panel: frame,
        getBounds: frameBounds,
        getRoot: () => frame.getRoot(),
        isVisible: frameVisible,
    });

    // Mouse wheel: hook Forge's GuiScreenEvent.MouseInputEvent.Pre, which fires per Mouse.next()
    // event BEFORE GuiScreen.handleMouseInput runs. Cancelling here suppresses both vanilla
    // GuiContainer scroll AND GuiContainerCreative tab/item-list scrolling when the cursor is
    // over one of our scroll viewports. Polling Mouse.getDWheel() in guiRender does NOT suppress
    // MC's reaction because MC reads per-event wheel via Mouse.getEventDWheel() during runTick,
    // which happens before guiRender; the accumulator and the per-event wheel are independent.
    register(ForgeMouseInputEventPre, (event: any) => {
        const dwheel = MouseClass.getEventDWheel();
        if (dwheel === 0) return;
        const mc = Client.getMinecraft();
        const screen = (mc as any).field_71462_r;
        if (screen === null || screen === undefined) return;
        const sr = new ScaledResolutionClass(mc);
        const sw = sr.func_78326_a();
        const sh = sr.func_78328_b();
        const dw = (mc as any).field_71443_c;
        const dh = (mc as any).field_71440_d;
        const mx = Math.floor((MouseClass.getEventX() * sw) / dw);
        const my = sh - Math.floor((MouseClass.getEventY() * sh) / dh) - 1;
        const trees = laidOutTrees();
        for (let i = 0; i < trees.length; i++) {
            const t = trees[i];
            const laid = layoutElement(t.root, t.rect.x, t.rect.y, t.rect.w, t.rect.h);
            for (let j = 0; j < laid.length; j++) {
                const el = laid[j].element;
                if (el.kind !== "scroll") continue;
                const s = getScrollState(el.id);
                if (!pointInRect(s.viewportRect, mx, my)) continue;
                const dir = dwheel > 0 ? 1 : -1;
                debug(`wheel dwheel=${dwheel} dir=${dir} cancelled+dispatched`);
                dispatchWheel(laid, mx, my, dir);
                cancel(event);
                return;
            }
        }
    });
    register("guiRender", (_mouseX: number, mouseY: number) => {
        if (isDraggingScrollbar()) updateScrollbarDrag(mouseY);
    });
    register("guiMouseRelease", () => {
        endScrollbarDrag();
    });

    // Clear focus when the user clicks anywhere outside every visible panel.
    register("guiMouseClick", (x: number, y: number) => {
        if (getFocusedInput() === null) return;
        for (let i = 0; i < activePanels.length; i++) {
            if (!activePanels[i].isVisible()) continue;
            if (pointInRect(activePanels[i].getBounds(), x, y)) return;
        }
        setFocusedInput(null);
    });

    // Keyboard: hook Forge's GuiScreenEvent.KeyboardInputEvent.Pre and forward to the focused
    // input's GuiTextField. This gives us cursor movement, selection (shift+arrows), home/end,
    // Ctrl+A/C/V/X, backspace/delete, and the real LWJGL char (CT's guiKey char is undefined).
    // Cancelling stops MC from reacting to e.g. "e" closing the inventory.
    register(ForgeKeyboardInputEventPre, (event: any) => {
        if (!KeyboardClass.getEventKeyState()) return; // key-up — ignore
        const keyCode = KeyboardClass.getEventKey();
        const focusedId = getFocusedInput();

        // Global T: when no input is focused and the GUI is shown, focus the
        // chat input so the user can type messages without leaving the
        // inventory. Mirrors vanilla MC's "T opens chat" affordance.
        if (focusedId === null && enabled && keyCode === KEY_T) {
            if (getContainerBounds() !== null) {
                setFocusedInput(CHAT_INPUT_ID);
                cancel(event);
            }
            return;
        }

        if (focusedId === null) return;
        const inputEl = findInput(focusedId);
        if (inputEl === null) {
            setFocusedInput(null);
            return;
        }
        const charCode = KeyboardClass.getEventCharacter();
        // Esc: clear focus + close popovers, but don't cancel — let MC also close the GUI.
        if (keyCode === 1) {
            setFocusedInput(null);
            if (popoverIsOpen()) closeAllPopovers();
            return;
        }
        if (keyCode === 28) {
            // Enter: if the input has an onSubmit handler, run it (the
            // handler is responsible for clearing focus / clearing text).
            // Otherwise just unfocus.
            if (inputEl.onSubmit) {
                inputEl.onSubmit();
            } else {
                setFocusedInput(null);
            }
            cancel(event);
            return;
        }
        const rec = getRecord(focusedId);
        if (rec === null) {
            cancel(event);
            return;
        }
        rec.field.func_146195_b(true); // setFocused — required for textboxKeyTyped to accept input
        rec.field.func_146201_a(charCode, keyCode); // textboxKeyTyped(char, key)
        const newText = readAndSync(focusedId);
        if (newText !== null) {
            const current =
                typeof inputEl.value === "function" ? inputEl.value() : inputEl.value;
            if (newText !== current) inputEl.onChange(newText);
        }
        cancel(event);
    });

    // Keep GuiTextField cursor blink animated and external focus state in sync. Also drop
    // popovers + focus whenever the underlying inventory GUI is no longer open, so they don't
    // linger across opens/closes.
    register("tick", () => {
        tickAllFields();
        applyFocus(getFocusedInput());
        tickReparse();
        if (getContainerBounds() === null) {
            if (popoverIsOpen()) closeAllPopovers();
            if (getFocusedInput() !== null) setFocusedInput(null);
        }
    });

    // Per-frame state snapshot, ~once per second to avoid log spam.
    let lastFrameLog = 0;
    register("guiRender", () => {
        if (!debugActive()) return;
        const now = Date.now();
        if (now - lastFrameLog < 500) return;
        lastFrameLog = now;
        const b = getContainerBounds();
        debug(
            `state focused=${getFocusedInput()} popoverOpen=${popoverIsOpen()} ` +
                `bounds=${b === null ? "null" : `${b.screenW}x${b.screenH}`}`
        );
    });

    // Register popover rendering LAST so it paints on top of all panels.
    initPopoverRendering();

    // Best-effort initial parse so the panel populates before the user
    // touches the path input. autoDiscover handles the case where the
    // default path doesn't exist by walking ./htsw/imports for any
    // import.json. Failures are stored in state.parseError and surfaced
    // inline by the LeftRail empty-state.
    try {
        autoDiscoverImportJson();
        reparseImportJson();
    } catch (_e) {
        // ignore — state.parseError will be set
    }
}

function findInput(id: string): Extract<Element, { kind: "input" }> | null {
    const trees = laidOutTrees();
    for (let i = 0; i < trees.length; i++) {
        const found = walkForInput(trees[i].root, id);
        if (found !== null) return found;
    }
    return null;
}

function walkForInput(
    e: Element,
    id: string
): Extract<Element, { kind: "input" }> | null {
    if (e.kind === "input" && e.id === id) return e;
    if (e.kind === "container" || e.kind === "scroll") {
        const children = typeof e.children === "function" ? e.children() : e.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === false) continue;
            const f = walkForInput(child, id);
            if (f !== null) return f;
        }
    }
    return null;
}

export function toggleHtswGui(): boolean {
    enabled = !enabled;
    return enabled;
}

export function armHtswGuiDebug(seconds: number): void {
    debugUntilMs = Date.now() + seconds * 1000;
    debugBuffer = `[${Date.now()}] armed for ${seconds}s\n`;
    FileLib.write(DEBUG_LOG_PATH, debugBuffer);
    ChatLib.chat(`&7[htsw-gui] armed for ${seconds}s`);
}
