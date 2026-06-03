import { S30PacketWindowItems } from "../../utils/packets";

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
        // @ts-ignore
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

register("packetReceived", (packet) => {
    maybeResolve("packetReceived", packet);
    maybeUpdateWindowID(packet);
});

register("packetSent", (packet) => {
    maybeResolve("packetSent", packet);
});

register("chat", (event) => {
    // @ts-ignore
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
