import {
    C10PacketCreativeInventoryAction,
    S2DPacketOpenWindow,
    S2FPacketSetSlot,
    S30PacketWindowItems,
} from "../../utils/packets";
import { recordImportDiagnostic } from "../../diagnostics/importDiagnosticsBuffer";

type Packet = MCPacket<MCINetHandler>;

// The event types you can wait on, and the predicate signature each one
// checks against. Call as `waitFor(eventName, optionalPredicate)`.
type CheckPredicateMap = {
    tick: () => boolean;
    packetReceived: (packet: Packet) => boolean;
    packetSent: (packet: Packet) => boolean;
    message: (message: string) => boolean;
};

type EventContainer<C extends (...args: any[]) => boolean> = {
    check: C;
    resolve: (value: Parameters<C>) => void;
    remaining: number;
};

type EventContainers = {
    [K in keyof CheckPredicateMap]: EventContainer<CheckPredicateMap[K]>[];
};

const EVENT_CONTAINERS: EventContainers = {
    tick: [],
    packetReceived: [],
    packetSent: [],
    message: [],
};

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
}

register("tick", () => {
    maybeResolve("tick");
});

export let lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero: number = 0;

function maybeUpdateWindowID(packet: Packet) {
    if (!(packet instanceof S30PacketWindowItems)) return;
    const windowID = packet.func_148911_c();
    if (windowID === 0) return;
    lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero =
        windowID;
}

function packetClassName(packet: Packet): string {
    try {
        const name = packet.getClass().getName();
        return String(name).substring(String(name).lastIndexOf(".") + 1);
    } catch (_e) {
        return String(packet);
    }
}

function stackName(stack: unknown): string | null {
    if (stack === null || stack === undefined) return null;
    try {
        return String((stack as { func_82833_r(): string }).func_82833_r());
    } catch (_e) {
        return "<stack>";
    }
}

function packetSlot(packet: unknown): number | null {
    try {
        return (packet as { func_149173_d(): number }).func_149173_d();
    } catch (_e) {
        return null;
    }
}

function packetWindow(packet: unknown): number | null {
    try {
        return (packet as { func_149175_c(): number }).func_149175_c();
    } catch (_e) {
        return null;
    }
}

function packetStack(packet: unknown): string | null {
    try {
        return stackName((packet as { func_149174_e(): unknown }).func_149174_e());
    } catch (_e) {
        return null;
    }
}

function creativePacketSlot(packet: unknown): number | null {
    try {
        return (packet as { func_149627_c(): number }).func_149627_c();
    } catch (_e) {
        return null;
    }
}

function creativePacketStack(packet: unknown): string | null {
    try {
        return stackName((packet as { func_149625_d(): unknown }).func_149625_d());
    } catch (_e) {
        return null;
    }
}

function recordPacket(direction: "received" | "sent", packet: Packet): void {
    if (packet instanceof S2DPacketOpenWindow) {
        recordImportDiagnostic("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: s2dOpenWindowId(packet),
            title: s2dOpenTitle(packet),
        });
    } else if (packet instanceof S30PacketWindowItems) {
        recordImportDiagnostic("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: packet.func_148911_c(),
        });
    } else if (packet instanceof S2FPacketSetSlot) {
        recordImportDiagnostic("packet", {
            direction,
            packet: packetClassName(packet),
            windowId: packetWindow(packet),
            slot: packetSlot(packet),
            stack: packetStack(packet),
        });
    } else if (packet instanceof C10PacketCreativeInventoryAction) {
        recordImportDiagnostic("packet", {
            direction,
            packet: packetClassName(packet),
            slot: creativePacketSlot(packet),
            stack: creativePacketStack(packet),
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

function s2dOpenWindowId(packet: unknown): number {
    try {
        return (packet as { func_148901_c(): number }).func_148901_c();
    } catch (_e) {
        return -1;
    }
}

function s2dOpenTitle(packet: unknown): string {
    try {
        const comp = (packet as {
            func_148903_d(): { func_150260_c(): string };
        }).func_148903_d();
        const text = comp.func_150260_c();
        return text === null || text === undefined ? "?" : text;
    } catch (_e) {
        return "?";
    }
}

function recordWindowOpen(packet: Packet): void {
    if (!(packet instanceof S2DPacketOpenWindow)) return;
    recentWindowOpens.push({
        at: Date.now(),
        windowId: s2dOpenWindowId(packet),
        title: s2dOpenTitle(packet),
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

register("packetReceived", (packet) => {
    recordPacket("received", packet);
    maybeResolve("packetReceived", packet);
    maybeUpdateWindowID(packet);
    recordWindowOpen(packet);
});

register("packetSent", (packet) => {
    recordPacket("sent", packet);
    maybeResolve("packetSent", packet);
});

register("chat", (event) => {
    // @ts-expect-error CTAutocomplete's chat trigger event type is too narrow here.
    const message = ChatLib.getChatMessage(event, true);
    maybeResolve("message", message);
});

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
    };
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
        EVENT_CONTAINERS.message.length;
    EVENT_CONTAINERS.tick.length = 0;
    EVENT_CONTAINERS.packetReceived.length = 0;
    EVENT_CONTAINERS.packetSent.length = 0;
    EVENT_CONTAINERS.message.length = 0;
    return total;
}

type EventName = keyof CheckPredicateMap;

type ContainerFor<E extends EventName> = EventContainers[E][number];
type ParametersFor<E extends EventName> = Parameters<CheckPredicateMap[E]>;

export type WaitForPromise<T> = Promise<T> & {
    cleanupWaiter?: () => void;
};

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
    }) as WaitForPromise<ParametersFor<E>>;

    function cleanup(): void {
        if (container === null) return;
        const containers = EVENT_CONTAINERS[event];
        const index = containers.indexOf(container);
        if (index !== -1) containers.splice(index, 1);
        container = null;
    }

    promise.cleanupWaiter = cleanup;
    return promise;
}
