import {
    C10PacketCreativeInventoryAction,
    S2DPacketOpenWindow,
    S2FPacketSetSlot,
    S30PacketWindowItems,
    creativeInventoryPacketSlot,
    creativeInventoryPacketStack,
    openWindowPacketId,
    openWindowPacketTitle,
    packetClassName,
    setSlotPacketSlot,
    setSlotPacketStack,
    setSlotPacketWindowId,
    windowItemsPacketId,
} from "../../utils/packets";
import { recordRuntimeDebug } from "../../runtimeDebug/runtimeDebugBuffer";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { runOnMainThread } from "../../utils/mainThread";
import { createTaskCancelledError } from "../cancellation";

type Packet = MCPacket<MCINetHandler>;

// The event types you can wait on, and the predicate signature each one
// checks against. Call as `waitFor(eventName, optionalPredicate)`.
type CheckPredicateMap = {
    tick: () => boolean;
    packetReceived: (packet: Packet) => boolean;
    packetSent: (packet: Packet) => boolean;
    message: (message: string) => boolean;
};

type EventContainer<C extends (...args: never[]) => boolean> = {
    check: C;
    resolve: (value: Parameters<C>) => void;
    remaining: number;
};

type EventContainers = {
    [K in keyof CheckPredicateMap]: EventContainer<CheckPredicateMap[K]>[];
};

type TimeoutEntry = {
    deadline: number;
    reason: string;
    duration: number;
    reject: (error: unknown) => void;
    isCancelled: () => boolean;
    cleanupInner?: () => void;
};

const EVENT_CONTAINERS: EventContainers = {
    tick: [],
    packetReceived: [],
    packetSent: [],
    message: [],
};
const TIMEOUTS: TimeoutEntry[] = [];
let packetCaptureForTask = false;

type EventTrigger =
    | {
          register?(): void;
          unregister?(): void;
      }
    | undefined;
const EVENT_TRIGGERS = {} as { [K in keyof CheckPredicateMap]: EventTrigger };

function unregisterEventTrigger(trigger: EventTrigger): void {
    trigger?.unregister?.();
}

function updateTriggerRegistration(event: EventName): void {
    const needed =
        EVENT_CONTAINERS[event].length > 0 ||
        (event === "tick" && TIMEOUTS.length > 0) ||
        ((event === "packetReceived" || event === "packetSent") &&
            packetCaptureForTask);
    const trigger = EVENT_TRIGGERS[event];
    if (needed) trigger?.register?.();
    else unregisterEventTrigger(trigger);
}

// Resolve only the waiters present when this event fired. resolve() can re-enter
// synchronously (sync-drain polyfill): the awaiting continuation runs inline and
// may register a fresh waiter (e.g. a per-tick poll loop). Iterating a snapshot
// keeps that waiter for the NEXT event — otherwise an always-true `tick` waiter
// that re-registers itself resolves again in the same pass and spins an entire
// await-loop inside one real tick. Splice by identity, not index, so a
// re-entrant cleanup can't shift a live waiter into the slot being removed.
function maybeResolve<E extends EventName>(event: E, ...args: ParametersFor<E>) {
    const containers = EVENT_CONTAINERS[event];
    const snapshot = containers.slice();
    for (let i = 0; i < snapshot.length; i++) {
        const container = snapshot[i];
        // Skip if a prior re-entrant resolve/cleanup already removed it.
        if (containers.indexOf(container) === -1) continue;
        // @ts-expect-error The event-specific argument tuple is narrowed at runtime.
        if (!container.check(...args)) continue;
        container.remaining--;
        if (container.remaining <= 0) {
            const idx = containers.indexOf(container);
            if (idx !== -1) containers.splice(idx, 1);
            container.resolve(args);
        }
    }
    updateTriggerRegistration(event);
}

function cleanupTimeout(entry: TimeoutEntry): void {
    const idx = TIMEOUTS.indexOf(entry);
    if (idx !== -1) TIMEOUTS.splice(idx, 1);
    updateTriggerRegistration("tick");
}

function rejectExpiredTimeouts(): void {
    const now = Date.now();
    const snapshot = TIMEOUTS.slice();
    for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        if (TIMEOUTS.indexOf(entry) === -1) continue;

        if (entry.isCancelled()) {
            cleanupTimeout(entry);
            entry.cleanupInner?.();
            entry.reject(createTaskCancelledError());
            continue;
        }

        if (now < entry.deadline) continue;
        cleanupTimeout(entry);
        recordRuntimeDebug("timeout", {
            reason: entry.reason,
            duration: entry.duration,
        });
        entry.cleanupInner?.();
        entry.reject(new Error(`Timeout after ${entry.duration}ms: ${entry.reason}`));
    }
}

function onTick(): void {
    maybeResolve("tick");
    rejectExpiredTimeouts();
}

EVENT_TRIGGERS.tick = register("tick", onTick);
unregisterEventTrigger(EVENT_TRIGGERS.tick);

export let lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero: number = 0;

function maybeUpdateWindowID(packet: Packet) {
    if (!(packet instanceof S30PacketWindowItems)) return;
    const windowID = windowItemsPacketId(packet);
    if (windowID === null || windowID === 0) return;
    lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero =
        windowID;
}

function packetStack(packet: unknown): string | null {
    return summarizeItemStack(setSlotPacketStack(packet))?.name ?? null;
}

function packetStackSummary(packet: unknown): unknown {
    return summarizeItemStack(setSlotPacketStack(packet));
}

function creativePacketStack(packet: unknown): string | null {
    return summarizeItemStack(creativeInventoryPacketStack(packet))?.name ?? null;
}

function creativePacketStackSummary(packet: unknown): unknown {
    return summarizeItemStack(creativeInventoryPacketStack(packet));
}

function recordPacket(direction: "received" | "sent", packet: Packet): void {
    if (packet instanceof S2DPacketOpenWindow) {
        recordRuntimeDebug("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: openWindowPacketId(packet),
            title: openWindowPacketTitle(packet) ?? "?",
        });
    } else if (packet instanceof S30PacketWindowItems) {
        recordRuntimeDebug("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: windowItemsPacketId(packet),
        });
    } else if (packet instanceof S2FPacketSetSlot) {
        recordRuntimeDebug("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: setSlotPacketWindowId(packet),
            slot: setSlotPacketSlot(packet),
            stack: packetStack(packet),
            stackSummary: packetStackSummary(packet),
        });
    } else if (packet instanceof C10PacketCreativeInventoryAction) {
        recordRuntimeDebug("packet", {
            direction,
            packet: packetClassName(packet),
            slot: creativeInventoryPacketSlot(packet),
            stack: creativePacketStack(packet),
            stackSummary: creativePacketStackSummary(packet),
        });
    }
}

// Ring buffer of the most recent server window-opens, recorded for EVERY packet
// regardless of whether a waiter is active. When `waitForMenu` times out having
// never seen its window's S2D, this answers the only question that matters: did
// an S2DPacketOpenWindow for that click actually arrive (and we missed it), or
// did the server never open a window at all? The "ms ago" of each entry, read
// at timeout, places it before/after the click that should have triggered it.
type WindowOpenRecord = { at: number; windowId: number; title: string };
const RECENT_WINDOW_OPENS_MAX = 8;
const recentWindowOpens: WindowOpenRecord[] = [];

function recordWindowOpen(packet: Packet): void {
    if (!(packet instanceof S2DPacketOpenWindow)) return;
    recentWindowOpens.push({
        at: Date.now(),
        windowId: openWindowPacketId(packet) ?? -1,
        title: openWindowPacketTitle(packet) ?? "?",
    });
    if (recentWindowOpens.length > RECENT_WINDOW_OPENS_MAX) recentWindowOpens.shift();
}

/** Oldest→newest list of recent window-opens, each tagged with how long ago it
 *  arrived relative to now. For surfacing in menu-wait timeout diagnostics. */
export function describeRecentWindowOpens(): string {
    if (recentWindowOpens.length === 0) return "<none>";
    const now = Date.now();
    const parts: string[] = [];
    for (let i = 0; i < recentWindowOpens.length; i++) {
        const record = recentWindowOpens[i];
        const title = record.title.length > 24 ? `${record.title.substring(0, 24)}…` : record.title;
        parts.push(`win${record.windowId} "${title}" ${now - record.at}ms ago`);
    }
    return parts.join(", ");
}

// Packet triggers fire on Netty IO threads. Resolving a waiter there resumes
// the awaiting task code on that thread (sync-drain polyfill runs continuations
// inline), and any GUI call it then makes crashes the client — see
// runOnMainThread. Hop before touching EVENT_CONTAINERS or resolving anything;
// the scheduled-task queue keeps packets in arrival order.
EVENT_TRIGGERS.packetReceived = register("packetReceived", (packet) => {
    runOnMainThread(() => {
        recordPacket("received", packet);
        maybeResolve("packetReceived", packet);
        maybeUpdateWindowID(packet);
        recordWindowOpen(packet);
    });
});
unregisterEventTrigger(EVENT_TRIGGERS.packetReceived);

EVENT_TRIGGERS.packetSent = register("packetSent", (packet) => {
    runOnMainThread(() => {
        recordPacket("sent", packet);
        maybeResolve("packetSent", packet);
    });
});
unregisterEventTrigger(EVENT_TRIGGERS.packetSent);

EVENT_TRIGGERS.message = register("chat", (event) => {
    // Read the message before deferring — other chat handlers may mutate or
    // cancel the event after this trigger returns.
    // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
    const message = ChatLib.getChatMessage(event, true);
    runOnMainThread(() => maybeResolve("message", message));
});
unregisterEventTrigger(EVENT_TRIGGERS.message);

/**
 * Live waiter count per event type. Every received packet / tick re-runs
 * `.check()` on each entry, so a growing `packetReceived` or `tick` count is a
 * leak and a direct cause of input/GUI lag. Use to diagnose: between imports
 * these should all be ~0.
 */
export function getEventContainerCounts(): { [k: string]: number } {
    return {
        tick: EVENT_CONTAINERS.tick.length,
        packetReceived: EVENT_CONTAINERS.packetReceived.length,
        packetSent: EVENT_CONTAINERS.packetSent.length,
        message: EVENT_CONTAINERS.message.length,
        timeout: TIMEOUTS.length,
    };
}

export function setPacketCaptureForTask(active: boolean): void {
    packetCaptureForTask = active;
    updateTriggerRegistration("packetReceived");
    updateTriggerRegistration("packetSent");
}

/**
 * Drop every registered waiter. Safety net against leaked waiters (e.g. a
 * `withTimeout` that abandons an inner waiter it can't clean up): the importer
 * drives menus strictly sequentially, so at an import boundary nothing legit is
 * waiting and any survivors are leaks. Returns how many were purged. Abandoned
 * waiters whose promises are dropped on the floor will simply never resolve —
 * which is correct, since nothing awaits them anymore.
 */
export function resetEventContainers(): number {
    const total =
        EVENT_CONTAINERS.tick.length +
        EVENT_CONTAINERS.packetReceived.length +
        EVENT_CONTAINERS.packetSent.length +
        EVENT_CONTAINERS.message.length +
        TIMEOUTS.length;
    EVENT_CONTAINERS.tick.length = 0;
    EVENT_CONTAINERS.packetReceived.length = 0;
    EVENT_CONTAINERS.packetSent.length = 0;
    EVENT_CONTAINERS.message.length = 0;
    TIMEOUTS.length = 0;
    unregisterEventTrigger(EVENT_TRIGGERS.tick);
    unregisterEventTrigger(EVENT_TRIGGERS.packetReceived);
    unregisterEventTrigger(EVENT_TRIGGERS.packetSent);
    unregisterEventTrigger(EVENT_TRIGGERS.message);
    return total;
}

type EventName = keyof CheckPredicateMap;

type ContainerFor<E extends EventName> = EventContainers[E][number];
type ParametersFor<E extends EventName> = Parameters<CheckPredicateMap[E]>;

export type WaitForPromise<T> = Promise<T> & {
    cleanupWaiter?: () => void;
};

export function waitForTimeout(
    reason: string,
    duration: number,
    isCancelled: () => boolean,
    cleanupInner?: () => void
): WaitForPromise<never> {
    let entry: TimeoutEntry | null = null;
    const promise = new Promise<never>((_resolve, reject) => {
        entry = {
            deadline: Date.now() + duration,
            reason,
            duration,
            reject,
            isCancelled,
            cleanupInner,
        };
        TIMEOUTS.push(entry);
        updateTriggerRegistration("tick");
    }) as WaitForPromise<never>;

    promise.cleanupWaiter = (): void => {
        if (entry === null) return;
        cleanupTimeout(entry);
        entry = null;
    };
    return promise;
}

export function waitFor<E extends EventName>(
    event: E,
    check: CheckPredicateMap[E] | null = null,
    amount: number = 1
): WaitForPromise<ParametersFor<E>> {
    if (check === null) {
        check = () => true;
    }

    let container: ContainerFor<E> | null = null;
    const promise = new Promise<ParametersFor<E>>((resolve) => {
        container = {
            check,
            resolve,
            remaining: amount,
        };
        EVENT_CONTAINERS[event].push(container);
        updateTriggerRegistration(event);
    }) as WaitForPromise<ParametersFor<E>>;

    function cleanup(): void {
        if (container === null) return;
        const containers = EVENT_CONTAINERS[event];
        const index = containers.indexOf(container);
        if (index !== -1) containers.splice(index, 1);
        container = null;
        updateTriggerRegistration(event);
    }

    promise.cleanupWaiter = cleanup;
    return promise;
}
