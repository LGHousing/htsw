/**
 * Low-level menu/message wait primitives, broken out from helpers.ts so
 * paginatedList.ts can depend on them without creating a helpers ↔
 * paginatedList cycle (helpers.ts uses paginatedList for note-on-last-slot,
 * paginatedList needs `timedWaitForMenu` for page turns).
 *
 * Anything here is: synchronous-feeling wait, no clicking, no field setting.
 * Click + wait pairs live in helpers.ts.
 */
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { describeGuiScreenMenu, getMenuItemSlots, getOpenContainerWindowId, menuStateDescription } from "../../tasks/specifics/slots";
import { S2DPacketOpenWindow, S30PacketWindowItems } from "../../utils/packets";
import { type WaitForPromise } from "../../tasks/specifics/waitFor";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";
import { IMPORT_DEBUG } from "../diagnostics/importDebug";

const MENU_WAIT_TIMEOUT_MS = 6000;

// After the opened window's packets arrive, MC applies them in two separate
// main-thread steps: S2DPacketOpenWindow creates the container (sets the new
// windowId, EMPTY), then S30PacketWindowItems fills its slots. Either can lag
// a tick or two behind our first tick under load. So we poll until BOTH hold:
// the active container's windowId matches the window we saw open, AND it has
// at least one item (i.e. its WindowItems has been applied). Checking windowId
// alone catches the right window but can still scan it empty (the gap between
// the two steps). A click→menu reopen is ~1 tick, but a chat-input reopen is a
// server round-trip and can take many ticks — so the cap is generous (under the
// outer 6s timeout). On exceeding it we THROW rather than proceed: a clear "menu
// never populated" failure beats silently scanning a half-built menu and
// cascading into a confusing downstream error.
const CONTAINER_SWITCH_MAX_TICKS = 80;

// Histogram of how many ticks each menu wait needed before the opened window
// was active AND populated — i.e. the received→processed latency in ticks.
// Index = ticksWaited (1..MAX). `gaveUp` = never satisfied within the cap.
const menuWaitTickCounts: number[] = [];
let menuWaitGaveUp = 0;

function recordMenuWaitTicks(ticksWaited: number, satisfied: boolean): void {
    if (!satisfied) {
        menuWaitGaveUp++;
        return;
    }
    menuWaitTickCounts[ticksWaited] = (menuWaitTickCounts[ticksWaited] ?? 0) + 1;
}

/** Log the tick-latency distribution since the last flush, then reset. */
export function flushMenuWaitTickSummary(): void {
    if (!IMPORT_DEBUG) return;
    const parts: string[] = [];
    let total = 0;
    for (let t = 0; t < menuWaitTickCounts.length; t++) {
        const c = menuWaitTickCounts[t];
        if (c) {
            parts.push(`${t}t×${c}`);
            total += c;
        }
    }
    if (menuWaitGaveUp > 0) parts.push(`gaveUp×${menuWaitGaveUp}`);
    if (total > 0 || menuWaitGaveUp > 0) {
        ChatLib.chat(`&b[menu-wait] populate latency over ${total} waits: ${parts.join(", ")}`);
    }
    menuWaitTickCounts.length = 0;
    menuWaitGaveUp = 0;
}

function s2dWindowId(packet: unknown): number | null {
    try {
        return (packet as { func_148901_c(): number }).func_148901_c();
    } catch (_e) {
        return null;
    }
}

function s30WindowId(packet: unknown): number | null {
    try {
        return (packet as { func_148911_c(): number }).func_148911_c();
    } catch (_e) {
        return null;
    }
}

const PLAYER_INVENTORY_SLOTS = 36;

// Non-null menu items the WindowItems snapshot carries (its full array minus
// the trailing 36 player-inventory slots). WindowItems is the complete final
// state of the menu (it arrives after all the per-slot SetSlots), so this is
// exactly how many items the container will hold once the menu is fully
// applied — our deterministic "menu ready" target.
function s30MenuItemCount(packet: unknown): number {
    try {
        const items = (packet as { func_148910_d(): unknown[] }).func_148910_d();
        const end = Math.max(0, items.length - PLAYER_INVENTORY_SLOTS);
        let n = 0;
        for (let i = 0; i < end; i++) {
            if (items[i] !== null && items[i] !== undefined) n++;
        }
        return n;
    } catch (_e) {
        return 0;
    }
}

function openContainerItemCount(): number {
    const slots = getMenuItemSlots();
    return slots === null ? 0 : slots.length;
}

// Total slot count the WindowItems snapshot declares (full array length,
// including the trailing 36 player-inventory slots). Compared against the live
// container's getSize() to detect a window-size-vs-packet skew when the live
// item count under-reads the snapshot.
function s30SlotCount(packet: unknown): number {
    try {
        return (packet as { func_148910_d(): unknown[] }).func_148910_d().length;
    } catch (_e) {
        return 0;
    }
}

/**
 * Number of waitForMenu sequences with a registered packet/tick waiter right
 * now. The importer drives menus strictly sequentially, so this should never
 * exceed 1. If it does, a prior waitForMenu leaked its waiters (e.g. a timeout
 * that failed to clean up) — exactly the failure mode that produces
 * scan-against-stale-container bugs far downstream. Tripwire-logged below.
 */
let liveMenuWaiters = 0;

// `skipPopulateWait`: resolve as soon as the opened window is the active
// container, skipping the "reached its WindowItems count" wait. For containers
// whose live count never matches their server snapshot (only the anvil so far,
// whose result slot is computed client-side). Callers that know they opened one
// pass true; waitForMenu itself stays container-type-agnostic.
export function waitForMenu(
    ctx: TaskContext,
    skipPopulateWait: boolean = false
): WaitForPromise<void> {
    // Track the inner waiters so the timeout/cancel path in `withTimeout` —
    // and any caller racing this promise — can cancel them via `cleanupWaiter`
    // and prevent a leaked container from matching a packet meant for someone
    // else. CRITICAL: the promise handed to `withTimeout` must itself carry
    // `cleanupWaiter`; passing a bare async thunk loses it (the thunk's
    // anonymous promise has no `cleanupWaiter`, so withTimeout's `cleanup?.()`
    // silently no-ops on timeout and the waiters leak).
    let packetWaiter: WaitForPromise<unknown> | null = null;
    let tickWaiter: WaitForPromise<unknown> | null = null;

    let accounted = false;
    const release = (): void => {
        if (!accounted) return;
        accounted = false;
        liveMenuWaiters--;
    };
    const cleanup = (): void => {
        packetWaiter?.cleanupWaiter?.();
        tickWaiter?.cleanupWaiter?.();
        release();
    };

    if (IMPORT_DEBUG && liveMenuWaiters > 0) {
        ChatLib.chat(
            `&c[menu-wait] LEAK: ${liveMenuWaiters} waitForMenu waiter(s) already live when starting another — a prior wait did not clean up.`
        );
    }
    liveMenuWaiters++;
    accounted = true;

    const inner = (async (): Promise<void> => {
        try {
            // Anchor on the actual window-open event. Hypixel assigns a fresh
            // windowID and sends S2DPacketOpenWindow on every transition (open,
            // sub-open, go-back, page-turn), followed by that window's
            // S30PacketWindowItems. We capture the opened windowID from the S2D
            // and resolve only on the S30 that matches it. A single stateful
            // waiter (not S2D-then-S30 in sequence) avoids the microtask gap
            // where the S30 lands between resolving an S2D waiter and
            // registering an S30 waiter. Stray S30s for unrelated windows (e.g.
            // a transient/empty Housing menu) carry a different ID and are
            // ignored; the old `windowID !== lastWindowID` heuristic matched
            // them, landing us in the wrong menu.
            let openedWindowId: number | null = null;
            // The full item count the menu will have, read off its WindowItems
            // snapshot. The container reaching this == the menu fully applied.
            let expectedItems = 0;
            let snapshotSlots = 0;
            packetWaiter = ctx.waitFor("packetReceived", (packet) => {
                if (packet instanceof S2DPacketOpenWindow) {
                    const id = s2dWindowId(packet);
                    if (id !== null && id !== 0) openedWindowId = id;
                    return false;
                }
                if (openedWindowId !== null && packet instanceof S30PacketWindowItems) {
                    if (s30WindowId(packet) !== openedWindowId) return false;
                    expectedItems = s30MenuItemCount(packet);
                    snapshotSlots = s30SlotCount(packet);
                    return true;
                }
                return false;
            });
            await packetWaiter;

            // The sync-drain Promise polyfill runs our post-`await` continuation
            // synchronously at tick-start, before MC's packet-processing step
            // applies the menu. So poll each tick until the active container is
            // the window we saw open AND the menu is fully applied — for normal
            // menus that's the container reaching the WindowItems count. A fixed
            // target reached once, no "stable count" guessing that hangs on
            // menus whose count never holds still. Callers that opened a
            // container whose count never matches its snapshot (anvil) pass
            // skipPopulateWait to resolve on the window becoming active alone.
            let ticksWaited = 0;
            let ready = false;
            let lastCurId: number | null = null;
            let lastCount = 0;
            let maxCount = 0;
            let everMatchedWindow = false;
            const loopStartMs = Date.now();
            for (let i = 0; i < CONTAINER_SWITCH_MAX_TICKS; i++) {
                tickWaiter = ctx.waitFor("tick");
                await tickWaiter;
                ticksWaited++;
                if (openedWindowId === null) { ready = true; break; }
                const curId = getOpenContainerWindowId();
                lastCurId = curId;
                if (curId === null) { ready = true; break; }
                if (curId !== openedWindowId) continue;
                everMatchedWindow = true;
                const count = openContainerItemCount();
                lastCount = count;
                if (count > maxCount) maxCount = count;
                if (skipPopulateWait || count >= Math.max(1, expectedItems)) {
                    ready = true;
                    break;
                }
            }
            if (openedWindowId !== null) {
                recordMenuWaitTicks(ticksWaited, ready);
                if (!ready) {
                    const elapsed = Date.now() - loopStartMs;
                    const why = !everMatchedWindow
                        ? `active container stuck on windowId ${lastCurId} (never became ${openedWindowId})`
                        : `observed ${lastCount}/${expectedItems} items (peak ${maxCount}); ` +
                          `snapshot slots=${snapshotSlots} vs live${menuStateDescription()}; gui=${describeGuiScreenMenu()}`;
                    throw new Error(
                        `Menu window ${openedWindowId} opened but not ready within ${CONTAINER_SWITCH_MAX_TICKS} ticks (${ticksWaited} ticks/${elapsed}ms): ${why}`
                    );
                }
            }
        } finally {
            release();
        }
    })() as WaitForPromise<void>;
    inner.cleanupWaiter = cleanup;

    const promise = ctx.withTimeout(
        inner,
        "Waiting for menu to load",
        MENU_WAIT_TIMEOUT_MS
    ) as WaitForPromise<void>;
    promise.cleanupWaiter = cleanup;

    // Pre-attach a no-op catch so when a racing caller calls cleanupWaiter and
    // we eventually time out with no listener, the rejection isn't reported as
    // unhandled.
    promise.catch(() => {});

    return promise;
}

export function timedWaitForMenu(
    ctx: TaskContext,
    kind: "menuClickWait" | "pageTurnWait" | "goBackWait" | "commandMenuWait" = "menuClickWait"
): WaitForPromise<void> {
    const expected =
        kind === "pageTurnWait"
            ? COST.pageTurnWait
            : kind === "goBackWait"
              ? COST.goBackWait
              : kind === "commandMenuWait"
                ? COST.commandMenuWait
                : COST.menuClickWait;
    return timed(kind, expected, () => waitForMenu(ctx));
}

async function waitForUnformattedMessage(
    ctx: TaskContext,
    message: string
): Promise<void> {
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) => removedFormatting(chatMessage) === message
        ),
        "Waiting for message in chat"
    );
}

export async function timedWaitForUnformattedMessage(
    ctx: TaskContext,
    message: string,
    kind: "commandMessageWait" | "messageClickWait" = "commandMessageWait"
): Promise<void> {
    await timed(
        kind,
        kind === "messageClickWait" ? COST.messageClickWait : COST.commandMessageWait,
        () => waitForUnformattedMessage(ctx, message)
    );
}
