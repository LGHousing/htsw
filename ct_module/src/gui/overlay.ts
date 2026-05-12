/// <reference types="../../CTAutocomplete" />

import { Panel } from "./lib/panel";
import { Element, Rect, layoutElement, pointInRect, getScrollState } from "./lib/layout";

// LWJGL globals not in CT autocomplete.
// @ts-ignore
const MouseClass = Java.type("org.lwjgl.input.Mouse");
// @ts-ignore
const KeyboardClass = Java.type("org.lwjgl.input.Keyboard");
// Forge inner-class path uses $ separators with Java.type.
// @ts-ignore
const ForgeMouseInputEventPre = Java.type(
    "net.minecraftforge.client.event.GuiScreenEvent$MouseInputEvent$Pre"
);
// @ts-ignore
const ForgeKeyboardInputEventPre = Java.type(
    "net.minecraftforge.client.event.GuiScreenEvent$KeyboardInputEvent$Pre"
);
import { RootTree, getImportCachedBounds } from "./root";
import { getContainerBounds, getFullscreenPanelRect } from "./lib/bounds";
import { autoDiscoverImportJson, reparseImportJson, tickReparse } from "./state/reparse";
import { CHAT_INPUT_ID } from "./chat-input";
import {
    initPopoverRendering,
    popoverIsOpen,
    closeAllPopovers,
    getOpenPopoverContents,
    tryDispatchPopoverWheel,
    mouseIsOverPopover,
} from "./lib/popovers";
import {
    getHousingUuid,
    getImportProgress,
    getParsedResult,
    isImportSoundsMuted,
    setHousingUuid,
    setKnowledgeRows,
} from "./state";
import { buildKnowledgeStatusRows } from "../knowledge/status";
import { getCurrentHousingUuid } from "../knowledge/housingId";
import { TaskManager } from "../tasks/manager";

import { getChatKeyCode } from "./keybinds";
import {
    dispatchWheel,
    isDraggingScrollbar,
    updateScrollbarDrag,
    endScrollbarDrag,
    setRenderDebugLog,
    renderElement,
} from "./lib/render";
import { getFocusedInput, setFocusedInput } from "./lib/focus";
import { applyFocus, getRecord, readAndSync, tickAllFields } from "./lib/inputState";
import {
    getEffectiveOverlayScale,
    mcToOverlay,
    getContainerBoundsOverlay,
    getOverlayScreenW,
    getOverlayScreenH,
} from "./lib/overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./lib/panel";
import { COLOR_OVERLAY_DIM } from "./lib/theme";

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
    // Use the overlay-converted bounds so the panel rect lives in overlay coords (1 unit =
    // OVERLAY_SCALE real pixels). bounds.ts itself is left untouched.
    const b = getContainerBoundsOverlay();
    if (b !== null) return getFullscreenPanelRect(b);
    // Mid-import gap (Hypixel closed the housing menu to prompt for chat
    // input). Reuse the bounds we captured the last time the menu was open
    // so the panel layout stays put instead of collapsing to nothing.
    if (getImportProgress() !== null) {
        const cached = getImportCachedBounds();
        if (cached !== null) return getFullscreenPanelRect(cached);
    }
    return ZERO_RECT;
}

function frameVisible(): boolean {
    if (!enabled) return false;
    if (getContainerBounds() !== null) return true;
    return getImportProgress() !== null && getImportCachedBounds() !== null;
}

// Housing-UUID auto-fetch. We only run `/wtfmap` when we actually need
// the UUID — firing it on every inventory open spams chat. Triggers:
//   1. Module load with a null UUID and the user opened a housing GUI.
//   2. Hypixel just sent a "Sending you to <server>..." transport
//      message — the user changed lobbies/houses, the cached UUID is
//      stale. We clear it; the next inventory open path catches case 1.
// The transport handler also zeroes `lastUuidFetchAt` so the cooldown
// from any prior failed fetch (e.g. one attempted from limbo where
// `/wtfmap` returns "Unknown command") doesn't gate the new attempt.
let uuidFetchInFlight = false;
let lastUuidFetchAt = 0;
const UUID_FETCH_COOLDOWN_MS = 60_000;

function refreshKnowledgeFromUuid(uuid: string): void {
    const parsed = getParsedResult();
    if (parsed === null) return;
    setKnowledgeRows(buildKnowledgeStatusRows(uuid, parsed.value));
}

function maybeAutoFetchHousingUuid(): void {
    if (uuidFetchInFlight) return;
    if (getHousingUuid() !== null) return;
    if (Date.now() - lastUuidFetchAt < UUID_FETCH_COOLDOWN_MS) return;
    uuidFetchInFlight = true;
    lastUuidFetchAt = Date.now();
    void TaskManager.run(async (ctx) => {
        const uuid = await getCurrentHousingUuid(ctx);
        setHousingUuid(uuid);
        refreshKnowledgeFromUuid(uuid);
    })
        .catch(() => {
            /* not in a housing / timeout — leave dots as-is */
        })
        .then(() => {
            uuidFetchInFlight = false;
        });
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

/**
 * Paint the overlay's dim shade + panel tree using the cached menu rect,
 * for the brief gaps when no GuiContainer is open during an import.
 * No-op outside of those gaps so the regular `guiRender` panel paint is
 * the source of truth whenever a GuiContainer is up. Coords come in as
 * MC-scaled and are converted to overlay space.
 */
function paintImportShade(rawX: number, rawY: number, root: Element): void {
    if (!enabled) return;
    if (getImportProgress() === null) return;
    if (getContainerBounds() !== null) return;
    const cached = getImportCachedBounds();
    if (cached === null) return;
    const b = getFullscreenPanelRect(cached);
    const x = mcToOverlay(rawX);
    const y = mcToOverlay(rawY);
    beginHtswOverlayDraw();
    // Inventory dim — a single flat scrim is close enough to MC's
    // vertical gradient and matches the scrim we already use for modal
    // popovers, so transient gaps don't visually pop.
    Renderer.drawRect(COLOR_OVERLAY_DIM, 0, 0, getOverlayScreenW(), getOverlayScreenH());
    const interactive = !mouseIsOverPopover(x, y);
    renderElement(root, b.x, b.y, b.w, b.h, x, y, interactive);
    endHtswOverlayDraw();
}

export function initHtswGui(): void {
    if (initialized) return;
    initialized = true;

    setRenderDebugLog(debug);

    // Hypixel server-transport messages are the cleanest "you may have
    // changed housings" signal. When we see one, drop the cached UUID and
    // knowledge rows so the next inventory open re-runs `/wtfmap` for the
    // new server. Both `setCriteria("Sending you to ${server}...")` and a
    // `^Sending you to ` regex were observed to silently never fire here,
    // so we match on `${*}` and prefix-test the unformatted message in JS.
    // We also clear `lastUuidFetchAt`: a prior failed `/wtfmap` (e.g. one
    // attempted from a lobby) sets the cooldown, which would otherwise
    // gate the next auto-fetch in the new housing for up to 60s.
    register("chat", (event: any) => {
        const msg = ChatLib.getChatMessage(event, false);
        if (typeof msg !== "string") return;
        if (msg.indexOf("Sending you to ") !== 0) return;
        setHousingUuid(null);
        setKnowledgeRows([]);
        lastUuidFetchAt = 0;
    }).setCriteria("${*}");

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

    // Mid-import fallback paint. When Hypixel closes the housing menu to
    // prompt for a chat-entered value, `getContainerBounds()` flips to
    // null and the regular `guiRender` (Forge BackgroundDrawnEvent) stops
    // firing — leaving a visible flash between menus. While an import is
    // in flight and we have a cached menu rect, repaint the same overlay
    // (plus a dim shade mimicking MC's `drawDefaultBackground`) from
    // whichever trigger does fire in the no-GuiContainer state:
    //   - `postGuiRender` fires for any GuiScreen, including GuiChat
    //     which doesn't trip BackgroundDrawnEvent.
    //   - `renderOverlay` fires for the in-game HUD path, which is what
    //     we get during the brief gap when `currentScreen == null`.
    // The HUD trigger fires every frame, so guard it to "no screen open"
    // to avoid double-painting alongside the panel/postGuiRender paints.
    register("renderOverlay", () => {
        const screen = (Client.getMinecraft() as any).field_71462_r;
        if (screen !== null && screen !== undefined) return;
        paintImportShade(0, 0, frame.getRoot());
    });
    register("postGuiRender", (mouseX: number, mouseY: number) =>
        paintImportShade(mouseX, mouseY, frame.getRoot())
    );

    // Sound mute. While `muteImportSounds` is on and an import is in
    // flight, cancel `Forge.PlaySoundEvent` so the repetitive ding/click
    // sounds Hypixel plays on every menu open during a sync don't fire.
    // We do not touch the master volume — friend PMs / other sounds
    // outside the import keep playing.
    register("soundPlay", (
        _position: any,
        _name: string,
        _vol: number,
        _pitch: number,
        _category: any,
        event: any
    ) => {
        if (!enabled) return;
        if (getImportProgress() === null) return;
        if (!isImportSoundsMuted()) return;
        cancel(event);
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
        // Convert raw real-pixel mouse coords directly into overlay space —
        // 1 overlay unit = effective overlay scale real pixels.
        const dh = (mc as any).field_71440_d;
        const s = getEffectiveOverlayScale();
        const overlayScreenH = Math.floor(dh / s);
        const mx = Math.floor(MouseClass.getEventX() / s);
        const my = overlayScreenH - Math.floor(MouseClass.getEventY() / s) - 1;
        // Popovers paint on top of panels so they should also see the wheel first. Without
        // this, scrolling inside the file-browser/recents popovers fell through to whatever
        // panel scroll happened to be under the cursor.
        if (popoverIsOpen()) {
            const dir = dwheel > 0 ? 1 : -1;
            if (tryDispatchPopoverWheel(mx, my, dir)) {
                debug(`wheel dwheel=${dwheel} dir=${dir} cancelled+dispatched (popover)`);
                cancel(event);
                return;
            }
        }
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
        if (isDraggingScrollbar()) updateScrollbarDrag(mcToOverlay(mouseY));
    });
    register("guiMouseRelease", () => {
        endScrollbarDrag();
    });

    // Clear focus when the user clicks anywhere outside every visible panel.
    register("guiMouseClick", (rawX: number, rawY: number) => {
        if (getFocusedInput() === null) return;
        const x = mcToOverlay(rawX);
        const y = mcToOverlay(rawY);
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

        // Global chat-focus key: when no input is focused and the GUI is
        // shown, focus the chat input so the user can type messages without
        // leaving the inventory. Mirrors vanilla MC's "T opens chat"
        // affordance; key is Minecraft's existing Open Chat binding.
        const chatKey = getChatKeyCode();
        if (focusedId === null && enabled && chatKey > 0 && keyCode === chatKey) {
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
        } else {
            maybeAutoFetchHousingUuid();
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
    // Popover content lives outside the panel trees — walk it too so
    // typing in a popover input can locate the focused element.
    const popoverContents = getOpenPopoverContents();
    for (let i = 0; i < popoverContents.length; i++) {
        const found = walkForInput(popoverContents[i], id);
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
