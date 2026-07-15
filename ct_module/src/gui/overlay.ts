/// <reference types="../../CTAutocomplete" />

import { Panel } from "./lib/panel";
import {
    Element,
    LaidOut,
    Rect,
    layoutElement,
    pointInRect,
    getScrollState,
    setScrollEasingProvider,
} from "./lib/layout";
import { markGuiDirty } from "./lib/dirty";
import {
    getShowChatPanel,
    getShowInventoryButtons,
    getSmoothScrolling,
} from "../settings";
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
const RenderGameOverlayElementType = javaType(
    "net.minecraftforge.client.event.RenderGameOverlayEvent$ElementType"
);
// Subscribed via raw Forge instead of CT's `guiOpened` trigger because
// CT's `ClientListener.onGuiOpened` has `if (event.gui == null) return;`
// — verified by disassembly. The null transitions are exactly the ones
// we need to catch to stop the placeholder-screen flash mid-import.
const ForgeGuiOpenEvent = javaType("net.minecraftforge.client.event.GuiOpenEvent");
import { RootTree, getImportCachedBounds } from "./root";
import {
    getContainerBounds,
    getFullscreenPanelRect,
    getOpenContainerBottomExtension,
    getOpenContainerBounds,
} from "./lib/bounds";
import { BottomToolbar } from "./bottom-toolbar";
import { Container } from "./lib/components";
import { handleCompletedParse, tickReparse } from "./parsing/reparse";
import { onParseCacheEntryChanged, processPendingParses } from "./parsing/parses";
import { invalidateSourceDiffForParse } from "./code-view/sourceDiff";
import { CHAT_INPUT_ID } from "./chat";
import { refreshChatLines } from "./chat/mcChat";
import {
    initPopoverRendering,
    popoverIsOpen,
    closeAllPopovers,
    getOpenPopoverContents,
    tryDispatchPopoverWheel,
    mouseIsOverPopover,
} from "./lib/popovers";
import { maybeAutoStartTour } from "./popovers/tour";
import { debugLog, flushGuiDebug, isGuiDebugArmed } from "./lib/debugLog";
import { isParseInProgress } from "./state";
import {
    closeHoverCard,
    drawHoverCard,
    isHoverCardVisible,
    mouseIsOverHoverCard,
    tryDispatchHoverCardWheel,
} from "./lib/hoverCards";
import { areTaskSoundsMuted, getHousingUuid, setHousingUuid } from "./state";
import { getTaskProgress } from "./right-panel/import-tab/taskProgress";
import { detectHousingUuid } from "../importCache/housingId";
import { isTaskRunning } from "../tasks/runningState";
import { TaskManager } from "../tasks/manager";

import { getChatKeyCode, getInventoryKeyCode } from "./keybinds";
import { renderToast } from "./toast";
import { sampleProgressTraceTick } from "../housingSync/trace/progressTrace";
import { endTabDrag, tickTabDragAutoScroll } from "./right-panel/tabDrag";
import {
    dispatchWheel,
    isDraggingScrollbar,
    updateScrollbarDrag,
    endScrollbarDrag,
    hasDeferredTooltip,
    drawDeferredTooltip,
    clearDeferredTooltip,
} from "./lib/render";
import { getFocusedInput, setFocusedInput } from "./lib/focus";
import {
    clearSelection,
    copyActiveSelection,
    hasActiveSelection,
    selectAllActive,
} from "./code-view/selection";
import { applyFocus, getRecord, readAndSync, tickAllFields } from "./lib/inputState";
import {
    getEffectiveOverlayScale,
    mcToOverlay,
    getContainerBoundsOverlay,
    getOpenContainerBoundsOverlay,
    getOverlayScreenW,
    getOverlayScreenH,
} from "./lib/overlayScale";
import { beginHtswOverlayDraw, endHtswOverlayDraw } from "./lib/overlayDraw";
import { openBoundProjectForHouse } from "./boundProject";

onParseCacheEntryChanged((entry) => {
    if (entry.parsed !== null) invalidateSourceDiffForParse(entry.parsed);
});

let enabled = true;
let initialized = false;

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

function frameBounds(): Rect {
    // Use the overlay-converted bounds so the panel rect lives in overlay coords (1 unit =
    // OVERLAY_SCALE real pixels). bounds.ts itself is left untouched.
    const b = getContainerBoundsOverlay();
    if (b !== null) return getFullscreenPanelRect(b);
    // Mid-import gap (Hypixel closed the housing menu to prompt for chat
    // input). Reuse the bounds we captured the last time the menu was open
    // so the panel layout stays put instead of collapsing to nothing.
    if (getTaskProgress() !== null) {
        const cached = getImportCachedBounds();
        if (cached !== null) return getFullscreenPanelRect(cached);
    }
    return ZERO_RECT;
}

function frameVisible(): boolean {
    if (!enabled) return false;
    // Only paint over Housing menus. `housingPresence` is the live /wtfmap
    // verdict — "in" only once we've actually confirmed a house on this
    // server — NOT the persisted UUID, which lingers in lobbies and would
    // otherwise keep the overlay covering non-Housing containers.
    if (housingPresence !== "in") return false;
    if (getContainerBounds() !== null) return true;
    return getTaskProgress() !== null && getImportCachedBounds() !== null;
}

function inventoryToolbarBounds(): Rect {
    const b = getOpenContainerBoundsOverlay();
    if (b === null) return ZERO_RECT;
    const y = b.top + b.ySize + mcToOverlay(getOpenContainerBottomExtension());
    return { x: b.left, y, w: b.xSize, h: Math.max(0, Math.min(26, b.screenH - y)) };
}

function inventoryToolbarVisible(): boolean {
    if (!enabled || !getShowInventoryButtons() || housingPresence !== "in") return false;
    return (
        getOpenContainerBounds() !== null &&
        getContainerBounds() === null &&
        inventoryToolbarBounds().h >= 9
    );
}

function InventoryToolbarTree(): Element {
    return Container({
        style: { width: { kind: "grow" }, height: { kind: "grow" } },
        children: () => [BottomToolbar(inventoryToolbarBounds().h)],
    });
}

function anyHtswPanelVisible(): boolean {
    return frameVisible() || inventoryToolbarVisible();
}

// Housing presence + UUID auto-fetch. `/wtfmap` is the only live "are we in a
// house right now" signal, but it costs a chat round-trip, so we run it at
// most once per server: when a container is open and presence is still
// "unknown". The verdict latches —
//   - a UUID → "in" (and we keep the UUID for cache lookups);
//   - "Unknown command" (not in a house — `/wtfmap` is housing-only) → "out".
// A "Sending you to <server>..." transport resets presence to "unknown" (and
// zeroes the cooldown) so the next container open re-checks the new server.
// The persisted UUID is deliberately NOT the gate: it survives into lobbies,
// so the overlay keys on `housingPresence` instead.
type HousingPresence = "unknown" | "in" | "out";
let housingPresence: HousingPresence = "unknown";
let lastDebugSampleAt = 0;
let uuidFetchInFlight = false;
let lastUuidFetchAt = 0;
const UUID_FETCH_COOLDOWN_MS = 60_000;

function maybeAutoFetchHousingUuid(): void {
    if (uuidFetchInFlight) return;
    if (housingPresence !== "unknown") return;
    if (Date.now() - lastUuidFetchAt < UUID_FETCH_COOLDOWN_MS) return;
    const task = TaskManager.tryRun(async (ctx) => {
        const uuid = await detectHousingUuid(ctx);
        if (uuid === null) {
            housingPresence = "out";
        } else {
            housingPresence = "in";
            setHousingUuid(uuid);
            openBoundProjectForHouse(uuid);
        }
    });
    if (task === null) return;
    uuidFetchInFlight = true;
    lastUuidFetchAt = Date.now();
    void task
        .catch(() => {
            /* timeout — stay "unknown" and allow a retry after the cooldown */
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

function laidOutTrees(): { root: Element; rect: Rect; laid: LaidOut[] | null }[] {
    const out: { root: Element; rect: Rect; laid: LaidOut[] | null }[] = [];
    for (let i = 0; i < activePanels.length; i++) {
        if (!activePanels[i].isVisible()) continue;
        out.push({
            root: activePanels[i].getRoot(),
            rect: activePanels[i].getBounds(),
            laid: activePanels[i].panel.getLaidOut(),
        });
    }
    return out;
}

// The one wheel-routing decision, shared by the suppression and application
// halves (see the wheel comment block in initHtswGui) so they can never
// disagree about which surface owns a wheel event. Precedence: popovers
// (paint on top, modals absorb everywhere), then hover cards, then the first
// panel scroll viewport under the cursor. With `apply` false this is a pure
// hit-test; `delta` is ignored.
function routeWheel(mx: number, my: number, delta: number, apply: boolean): boolean {
    if (popoverIsOpen()) {
        if (apply) {
            if (tryDispatchPopoverWheel(mx, my, delta)) return true;
        } else if (mouseIsOverPopover(mx, my)) {
            return true;
        }
    }
    if (apply) {
        if (tryDispatchHoverCardWheel(mx, my, delta)) return true;
    } else if (mouseIsOverHoverCard(mx, my)) {
        return true;
    }
    const trees = laidOutTrees();
    for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const laid = t.laid ?? layoutElement(t.root, t.rect.x, t.rect.y, t.rect.w, t.rect.h);
        for (let j = 0; j < laid.length; j++) {
            const el = laid[j].element;
            if (el.kind !== "scroll") continue;
            const s = getScrollState(el.id);
            if (!pointInRect(s.viewportRect, mx, my)) continue;
            if (apply) {
                dispatchWheel(laid, mx, my, delta);
            }
            return true;
        }
    }
    return false;
}

let lastWheelPollAt = 0;

function pollWheel(): void {
    const dwheel = MouseClass.getDWheel();
    const now = Date.now();
    // The accumulator collects wheel whether or not this poll is running
    // (guiRender only fires with a screen open). After a gap, whatever it
    // holds is stale in-world/other-screen input — drain and discard it
    // instead of applying a phantom scroll on the first overlay frame.
    const stale = now - lastWheelPollAt > 200;
    lastWheelPollAt = now;
    if (dwheel === 0 || stale) return;
    // Notches, keeping the hardware's real magnitude: a standard wheel click
    // is ±120, fast flicks coalesce into one larger reading, and high-res
    // wheels/touchpads report fractions of 120. Collapsing this to ±1 made
    // fast scrolling crawl.
    const delta = dwheel / 120;
    const mc = Client.getMinecraft();
    const dh = (mc as any).field_71440_d;
    const s = getEffectiveOverlayScale();
    const overlayScreenH = Math.floor(dh / s);
    const mx = Math.floor(MouseClass.getX() / s);
    const my = overlayScreenH - Math.floor(MouseClass.getY() / s) - 1;
    routeWheel(mx, my, delta, true);
}

function nativeScreenUsesTypedCharacters(): boolean {
    const screen = (Client.getMinecraft() as any).field_71462_r;
    if (screen === null || screen === undefined) return false;
    try {
        return String(screen.getClass().getName()).indexOf("GuiRepair") >= 0;
    } catch (_e) {
        return false;
    }
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

function paintImportShade(rawX: number, rawY: number, frame: Panel): void {
    if (!enabled) return;
    if (getTaskProgress() === null) return;
    if (getContainerBounds() !== null) return;
    const cached = getImportCachedBounds();
    if (cached === null) return;
    beginHtswOverlayDraw();
    try {
        Renderer.drawRect(
            COLOR_IMPORT_GAP_SHADE,
            0,
            0,
            getOverlayScreenW(),
            getOverlayScreenH()
        );
        frame.drawAt(rawX, rawY);
    } finally {
        endHtswOverlayDraw();
    }
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

    // Drive the lib's wheel easing from the user's "Smooth scrolling" setting.
    setScrollEasingProvider(getSmoothScrolling);

    // Hypixel server-transport messages are the cleanest "you may have
    // changed housings" signal. When we see one, drop the cached UUID and
    // cache-status rows so the next inventory open re-runs `/wtfmap` for the
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
        housingPresence = "unknown";
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

    const inventoryToolbar = new Panel(
        inventoryToolbarBounds,
        InventoryToolbarTree(),
        inventoryToolbarVisible,
        false
    );
    inventoryToolbar.register();
    activePanels.push({
        panel: inventoryToolbar,
        getBounds: inventoryToolbarBounds,
        getRoot: () => inventoryToolbar.getRoot(),
        isVisible: inventoryToolbarVisible,
    });

    // Mid-import fallback paint. When Hypixel closes the housing menu to
    // prompt for a chat-entered value, `getContainerBounds()` flips to
    // null and the regular `guiRender` (Forge BackgroundDrawnEvent) stops
    // firing — leaving a visible flash between menus. Paint via the
    // raw Forge `RenderGameOverlayEvent.Post` (CT's `renderOverlay`
    // trigger is the Pre event — running our paint before MC draws the
    // HUD, which lets chat/hotbar text bleed through ON TOP of our
    // scrim). GuiIngameForge fires Post once per HUD ELEMENT (17 call
    // sites — verified by disassembling forge-1.8.9-11.15.1.2318), so
    // without a filter this handler ran ~10× per frame. We act only on
    // ALL, which fires exactly once, at the very end of
    // renderGameOverlay after the entire vanilla HUD has been drawn —
    // so a fully opaque scrim there hides every HUD element.
    // `postGuiRender` covers the other state (any GuiScreen open, including
    // GuiChat) where `DrawScreenEvent.Post` is the natural late hook.
    register(RenderGameOverlayEventPost, (event: any) => {
        if (!RenderGameOverlayElementType.ALL.equals(event.type)) return;
        sampleProgressTraceTick();
        const screen = (Client.getMinecraft() as any).field_71462_r;
        if (screen !== null && screen !== undefined) return;
        paintImportShade(0, 0, frame);
        renderToast();
    });
    register("postGuiRender", (mouseX: number, mouseY: number) => {
        sampleProgressTraceTick();
        paintImportShade(mouseX, mouseY, frame);
        renderToast();
    });

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
        if (getTaskProgress() === null) return false;
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
        if (prevInGameHasFocus && !inGame && getTaskProgress() !== null) {
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
    register(ForgeGuiOpenEvent, (event: any) => {
        const incoming = event.gui;
        const current = (Client.getMinecraft() as any).field_71462_r;
        if (!enabled) return;
        if (incoming !== null && incoming !== undefined) return;
        if (getTaskProgress() === null) return;
        if (getImportCachedBounds() === null) return;
        const isInterceptable =
            isPlaceholderScreen(current) || getContainerBounds() !== null;
        if (!isInterceptable) return;
        event.gui = getPlaceholderScreen();
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
        if (getTaskProgress() === null) return;
        if (!areTaskSoundsMuted()) return;
        cancel(event);
    });

    // Mouse wheel, two cooperating halves over the SAME routing decision
    // (`routeWheel`):
    //
    // 1. Forge's GuiScreenEvent.MouseInputEvent.Pre — SUPPRESSION ONLY. It
    //    fires per Mouse.next() event BEFORE GuiScreen.handleMouseInput runs,
    //    which is the only place vanilla GuiContainer scroll and
    //    GuiContainerCreative tab/item-list scrolling can be cancelled. It
    //    does NOT apply the wheel to our scrolls.
    // 2. A per-frame `Mouse.getDWheel()` poll in guiRender (`pollWheel`) —
    //    APPLICATION. MC only drains the event queue during runTick (~20Hz),
    //    so applying from events moved scroll targets in visible ~50ms steps
    //    that the easing could only partially mask (20Hz velocity pulsing).
    //    The accumulator is refilled by Display.processMessages every FRAME
    //    and is independent of the per-event wheel (Mouse.getEventDWheel), so
    //    polling it feeds the targets at render rate without double-applying
    //    what the Pre handler saw. Draining it also doesn't starve MC — all
    //    vanilla handling reads per-event wheel.
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
        if (routeWheel(mx, my, 0, false)) cancel(event);
    });
    // Runs at default (NORMAL) priority, so everything here — the wheel poll's
    // target moves, dirty marks — lands BEFORE the panel paints this same
    // frame (Panel's render trigger is Priority.LOW). Moving any of it after
    // the paint costs one frame of input latency.
    register("guiRender", (mouseX: number, mouseY: number) => {
        pollWheel();
        tickTabDragAutoScroll(mcToOverlay(mouseX));
        const dragging = isDraggingScrollbar();
        if (dragging) updateScrollbarDrag(mcToOverlay(mouseY));
        if (frameVisible() && getShowChatPanel() && refreshChatLines()) markGuiDirty();
        // Rebuild every frame while the thumb is dragged or the wheel offset is
        // still easing, so scrolled content tracks at the refresh rate instead
        // of stepping on the dirty backstop.
        if (dragging) markGuiDirty();
    });
    register("guiMouseRelease", () => {
        endScrollbarDrag();
        endTabDrag();
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
        const screen = (Client.getMinecraft() as any).field_71462_r;
        const taskMenuOpen =
            isTaskRunning() &&
            (isPlaceholderScreen(screen) || getOpenContainerBounds() !== null);
        const inventoryCloseKey =
            focusedId === null &&
            !nativeScreenUsesTypedCharacters() &&
            keyCode === getInventoryKeyCode();
        if (taskMenuOpen && (keyCode === 1 || inventoryCloseKey)) {
            if (focusedId !== null) setFocusedInput(null);
            if (popoverIsOpen()) closeAllPopovers();
            markGuiDirty();
            cancel(event);
            return;
        }

        // Global chat-focus key: when no input is focused and the GUI is
        // shown, focus the chat input so the user can type messages without
        // leaving the inventory. Mirrors vanilla MC's "T opens chat"
        // affordance; key is Minecraft's existing Open Chat binding.
        const chatKey = getChatKeyCode();
        if (
            focusedId === null &&
            enabled &&
            getShowChatPanel() &&
            chatKey > 0 &&
            keyCode === chatKey
        ) {
            if (getContainerBounds() !== null && !nativeScreenUsesTypedCharacters()) {
                setFocusedInput(CHAT_INPUT_ID);
                markGuiDirty();
                cancel(event);
            }
            return;
        }

        if (focusedId === null) {
            // No text input focused: route copy/select-all to the code view's
            // read-only text selection when it owns one, but only while the
            // HTSW overlay is showing so we don't swallow Ctrl+C on other screens.
            if (frameVisible() && hasActiveSelection()) {
                const ctrlDown = KeyboardClass.isKeyDown(29) || KeyboardClass.isKeyDown(157);
                if (ctrlDown && keyCode === 46) {
                    copyActiveSelection();
                    cancel(event);
                } else if (ctrlDown && keyCode === 30) {
                    selectAllActive();
                    cancel(event);
                }
            }
            return;
        }
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
            markGuiDirty();
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
            if (newText !== current) {
                inputEl.onChange(newText);
                // Typing changes what the tree shows (filtered results, text
                // width) — rebuild next paint instead of waiting on the backstop.
                markGuiDirty();
            }
        }
        cancel(event);
    });

    // Keep GuiTextField cursor blink animated and external focus state in sync. Also drop
    // popovers + focus whenever the underlying inventory GUI is no longer open, so they don't
    // linger across opens/closes.
    register("tick", () => {
        tickAllFields();
        applyFocus(getFocusedInput());
        // Reparse polling stats the import.json every tick and (throttled)
        // every referenced file. During import/export those parses compete
        // with the task on the game thread; the next idle tick catches up.
        if (frameVisible() && !isTaskRunning()) {
            tickReparse();
            // Drain one off-frame parse queued by requestParse() (export pane,
            // Projects tree, queue rows) so a cold parse never blocks render.
            processPendingParses(handleCompletedParse);
        }
        // First-load walkthrough; once per session, never mid-import, and only
        // while the GUI can actually render a popover.
        if (frameVisible() && getTaskProgress() === null) {
            maybeAutoStartTour();
        }
        if (isGuiDebugArmed()) {
            const now = Date.now();
            if (now - lastDebugSampleAt >= 250) {
                lastDebugSampleAt = now;
                debugLog(
                    `tick frameVisible=${frameVisible()} popovers=${getOpenPopoverContents().length} ` +
                    `parseInProgress=${isParseInProgress()} uuid=${getHousingUuid()}`
                );
            }
        }
        flushGuiDebug();
        // If the import ended while our placeholder is still up (Hypixel
        // didn't reopen a menu — e.g. the import finished naturally on
        // the last menu close), dismiss it so the player isn't trapped
        // in a phantom GUI. Going placeholder → null calls
        // `grabMouseCursor` which doesn't move the cursor, so this is
        // snap-free even at import end.
        if (getTaskProgress() === null) {
            const mc = Client.getMinecraft() as any;
            if (isPlaceholderScreen(mc.field_71462_r)) {
                mc.func_147108_a(null);
            }
        }
        // Learn the housing UUID whenever a container is open, even before the
        // overlay shows — frameVisible() now gates on a known UUID, so the
        // fetch has to run independently of it or the overlay could never
        // appear (null UUID → hidden → never fetched).
        if (getOpenContainerBounds() !== null) {
            maybeAutoFetchHousingUuid();
        }
        // Only tear down popovers + focus when the overlay isn't showing at all.
        // frameVisible() stays true during an import gap (cached bounds), even
        // though getContainerBounds() flickers null between menu operations —
        // keying the teardown on getContainerBounds() here would drop overlay
        // popover/focus state on every one of those flickers.
        if (!anyHtswPanelVisible()) {
            if (popoverIsOpen()) closeAllPopovers();
            closeHoverCard();
            if (getFocusedInput() !== null) setFocusedInput(null);
            clearSelection();
        }
    });

    // Register popover rendering LAST so it paints on top of all panels.
    initPopoverRendering();

    register("postGuiRender", (mouseX: number, mouseY: number) => {
        if (popoverIsOpen()) {
            closeHoverCard();
            return;
        }
        beginHtswOverlayDraw();
        drawHoverCard(mcToOverlay(mouseX), mcToOverlay(mouseY));
        endHtswOverlayDraw();
    }).setPriority(OnTrigger.Priority.LOWEST);

    // Hover tooltips paint after popovers (and after MC's inventory/foreground),
    // so a chip near the inventory edge isn't covered by the slots. renderElement
    // only stashes the tooltip during the panel/popover passes; this draws it.
    register("postGuiRender", () => {
        if (!hasDeferredTooltip()) return;
        // A hover card owns the same space; drop the queued tooltip so it can't
        // resurface (sticky) once the card goes away.
        if (isHoverCardVisible()) {
            clearDeferredTooltip();
            return;
        }
        beginHtswOverlayDraw();
        drawDeferredTooltip();
        endHtswOverlayDraw();
    }).setPriority(OnTrigger.Priority.LOWEST);

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
