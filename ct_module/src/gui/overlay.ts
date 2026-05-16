/// <reference types="../../CTAutocomplete" />

import { Panel } from "./lib/panel";
import { Element, Rect, layoutElement, pointInRect, getScrollState } from "./lib/layout";
import { javaType } from "./lib/java";

declare const JavaAdapter: new (baseClass: any, implementation: object) => any;

const MouseClass = javaType("org.lwjgl.input.Mouse");
const KeyboardClass = javaType("org.lwjgl.input.Keyboard");
const ForgeMouseInputEventPre = javaType(
    "net.minecraftforge.client.event.GuiScreenEvent$MouseInputEvent$Pre"
);
const ForgeKeyboardInputEventPre = javaType(
    "net.minecraftforge.client.event.GuiScreenEvent$KeyboardInputEvent$Pre"
);
const GuiScreenClass = javaType("net.minecraft.client.gui.GuiScreen");
const RenderGameOverlayEventPost = javaType(
    "net.minecraftforge.client.event.RenderGameOverlayEvent$Post"
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
}function frameBounds(): Rect {
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
// Semi-transparent dark scrim matching MC's `drawDefaultBackground`
// gradient (top of MC's gradient is 0xC0101010 = 75% near-black). This is
// what the user sees behind a normal inventory, so painting it during the
// import gap reproduces the "inventory-open" feel rather than a hard
// blackout. Bleed-through is fine for the world; HUD text elements
// (chat/scoreboard/title/etc.) are suppressed separately via per-element
// Pre cancellations so they don't bleed through this 25% window.
const COLOR_IMPORT_GAP_SHADE = 0xc0101010 | 0;

let shadeFrameTick = 0;
function paintImportShade(rawX: number, rawY: number, root: Element, source: string): void {
    if (!enabled) return;
    if (getImportProgress() === null) return;
    if (getContainerBounds() !== null) return;
    const cached = getImportCachedBounds();
    if (cached === null) return;
    if (debugActive() && shadeFrameTick++ % 30 === 0) {
        const mc = Client.getMinecraft() as any;
        const cur = mc.field_71462_r;
        const curName = cur === null || cur === undefined ? "null" : String(cur.getClass().getName());
        debug(`paintImportShade via=${source} current=${curName} placeholder=${isPlaceholderScreen(cur)}`);
    }
    const b = getFullscreenPanelRect(cached);
    const x = mcToOverlay(rawX);
    const y = mcToOverlay(rawY);
    beginHtswOverlayDraw();
    Renderer.drawRect(
        COLOR_IMPORT_GAP_SHADE,
        0,
        0,
        getOverlayScreenW(),
        getOverlayScreenH()
    );
    const interactive = !mouseIsOverPopover(x, y);
    renderElement(root, b.x, b.y, b.w, b.h, x, y, interactive);
    endHtswOverlayDraw();
}

// Stand-in GuiScreen we swap in when Hypixel briefly closes the housing
// menu mid-import. Real fix for three problems that previously surfaced
// during that gap:
//   1. World/HUD flashed visible for a frame.
//   2. Chat lit up (full-bright + on top) because `currentScreen == null`
//      put MC back in "in-game" rendering mode.
//   3. Cursor snapped to screen center on the next GUI open.
// All three stem from the same cause: MC's `displayGuiScreen(null)` flips
// `inGameHasFocus` to true via `grabMouseCursor`; the next non-null open
// then calls `setIngameNotInFocus` → `ungrabMouseCursor` →
// `Mouse.setCursorPosition(W/2, H/2)`. Going GuiScreen-to-GuiScreen skips
// that path entirely (the `inGameHasFocus` guard short-circuits), so by
// redirecting null → placeholder we keep the cursor put AND keep MC in
// "GUI is open" rendering mode (chat dim, no HUD).
//
// Created lazily on first need so we don't pay the Java alloc until an
// import actually runs.
let placeholderScreen: any = null;
function getPlaceholderScreen(): any {
    if (placeholderScreen === null) placeholderScreen = new JavaAdapter(GuiScreenClass, {});
    return placeholderScreen;
}

function isPlaceholderScreen(s: any): boolean {
    return placeholderScreen !== null && s === placeholderScreen;
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
    // firing — leaving a visible flash between menus. Paint via the
    // raw Forge `RenderGameOverlayEvent.Post` (CT's `renderOverlay`
    // trigger is the Pre event — running our paint before MC draws the
    // HUD, which lets chat/hotbar text bleed through ON TOP of our
    // scrim). Post fires once per frame after the entire vanilla HUD has
    // been drawn, so a fully opaque scrim there hides every HUD element.
    // `postGuiRender` covers the other state (any GuiScreen open, including
    // GuiChat) where `DrawScreenEvent.Post` is the natural late hook.
    register(RenderGameOverlayEventPost, (_event: any) => {
        const screen = (Client.getMinecraft() as any).field_71462_r;
        if (screen !== null && screen !== undefined) return;
        paintImportShade(0, 0, frame.getRoot(), "renderGameOverlayPost");
    });
    register("postGuiRender", (mouseX: number, mouseY: number) =>
        paintImportShade(mouseX, mouseY, frame.getRoot(), "postGuiRender")
    );

    // Suppress HUD text elements during the import gap. Forge 1.8.9
    // renders renderChat, renderPlayerList, renderScoreboard, etc. inside
    // renderGameOverlay; cancelling their Pre events skips that draw
    // entirely. We keep the overlay scrim semi-transparent (matching MC's
    // inventory dim), and these cancellations make sure no bright chat /
    // scoreboard sidebar / title bleeds through that 25% bleed.
    //
    // Each cancellation is guarded to "import in flight + cached bounds +
    // no real container open" so normal play is untouched. We do NOT
    // cancel the hotbar/health/food/etc. icons — those are aesthetic only
    // and the scrim already dims them like any inventory would.
    function inImportGap(): boolean {
        if (!enabled) return false;
        if (getImportProgress() === null) return false;
        if (getImportCachedBounds() === null) return false;
        if (getContainerBounds() !== null) return false;
        return true;
    }
    register("renderChat", (event: any) => {
        if (inImportGap()) cancel(event);
    });
    register("renderScoreboard", (event: any) => {
        if (inImportGap()) cancel(event);
    });
    register("renderTitle", (event: any) => {
        if (inImportGap()) cancel(event);
    });
    register("renderPlayerList", (event: any) => {
        if (inImportGap()) cancel(event);
    });
    register("renderBossHealth", (event: any) => {
        if (inImportGap()) cancel(event);
    });

    // Cursor recenter mitigation. When MC closes a screen mid-import
    // (`displayGuiScreen(null)` somewhere in packet processing), it sets
    // `inGameHasFocus = true` via `grabMouseCursor` and hides the cursor.
    // The next `displayGuiScreen(non-null)` then runs `setIngameNotInFocus`
    // → `ungrabMouseCursor` → `Mouse.setCursorPosition(W/2, H/2)`, which
    // visually snaps the cursor to screen center.
    //
    // We can't reasonably hook the LWJGL call, but we can save the cursor
    // position every frame while not-in-grab, and immediately after a
    // grab→ungrab transition (mid-import only) restore it. The user sees
    // at most one frame at center before it pops back to where it was.
    let savedCursorX = -1;
    let savedCursorY = -1;
    let prevInGameHasFocus = false;
    register("step", () => {
        // Runs ~60Hz alongside the render loop, the finest granularity CT
        // exposes for cheap polling. Tick (20Hz) drops 2/3 of frames and
        // misses brief grab→ungrab cycles.
        const mc = Client.getMinecraft() as any;
        const inGame = mc.field_71415_G === true;
        if (prevInGameHasFocus && !inGame && getImportProgress() !== null) {
            // Just transitioned grab → ungrab while an import is in flight:
            // MC just centered the cursor inside `ungrabMouseCursor`. Put
            // it back where the user had it before the grab. Don't update
            // saved on this frame — the current cursor position IS the
            // center MC just snapped to.
            if (savedCursorX >= 0 && savedCursorY >= 0) {
                MouseClass.setCursorPosition(savedCursorX, savedCursorY);
            }
        } else if (!inGame) {
            // Stable not-in-grab — record the cursor position so we can
            // restore here if MC later grabs + ungrabs around an import.
            savedCursorX = MouseClass.getX();
            savedCursorY = MouseClass.getY();
        }
        prevInGameHasFocus = inGame;
    }).setFps(60);

    // Catch `displayGuiScreen(null)` mid-import and redirect to a
    // placeholder GuiScreen. See `getPlaceholderScreen` for the three
    // visual artifacts this addresses (flash, chat brightness flip,
    // cursor snap). Guarded so we only intercept when:
    //   - an import is actually in flight (don't mess with normal play)
    //   - we have cached bounds to paint into (so the placeholder isn't
    //     blank — the overlay shade + panels render via paintImportShade)
    //   - the outgoing screen is either a real inventory or our existing
    //     placeholder (so closing chat / pause menu still works normally)
    register("guiOpened", (event: any) => {
        const incoming = event.gui;
        const current = (Client.getMinecraft() as any).field_71462_r;
        const currentName =
            current === null || current === undefined
                ? "null"
                : String(current.getClass().getName());
        const incomingName =
            incoming === null || incoming === undefined
                ? "null"
                : String(incoming.getClass().getName());
        debug(
            `guiOpened from=${currentName} to=${incomingName} import=${
                getImportProgress() !== null
            } cached=${getImportCachedBounds() !== null} containerBounds=${
                getContainerBounds() !== null
            }`
        );
        if (!enabled) return;
        if (incoming !== null && incoming !== undefined) return;
        if (getImportProgress() === null) return;
        if (getImportCachedBounds() === null) return;
        const isInterceptable =
            isPlaceholderScreen(current) || getContainerBounds() !== null;
        if (!isInterceptable) {
            debug(`guiOpened intercept skipped — current not interceptable`);
            return;
        }
        event.gui = getPlaceholderScreen();
        debug(`guiOpened intercepted — redirected null → placeholder`);
    });

    // Sound mute. While `muteImportSounds` is on and an import is in
    // flight, cancel every `Forge.PlaySoundEvent` so the repetitive
    // ding/click sounds Hypixel plays on every menu open during a sync
    // don't fire. This is a broad cancel — chat dings and ambient audio
    // are also suppressed during the import. Master volume itself is
    // untouched, so audio resumes the moment the import ends or the
    // toggle is turned off.
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
        // If the import ended while our placeholder is still up (Hypixel
        // didn't reopen a menu — e.g. the import finished naturally on
        // the last menu close), dismiss it so the player isn't trapped
        // in a phantom GUI. Going placeholder → null calls
        // `grabMouseCursor` which doesn't move the cursor, so this is
        // snap-free even at import end.
        if (getImportProgress() === null) {
            const mc = Client.getMinecraft() as any;
            if (isPlaceholderScreen(mc.field_71462_r)) {
                mc.func_147108_a(null);
            }
        }
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
