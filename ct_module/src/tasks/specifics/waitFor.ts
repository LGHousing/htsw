import { S30PacketWindowItems } from "../../utils/packets";

type Packet = MCPacket<MCINetHandler>;

// this is only important one, use like `waitFor(key, [value])`
type CheckPredicateMap = {
    tick: () => boolean;
    packetReceived: (packet: Packet) => boolean;
    packetSent: (packet: Packet) => boolean;
    message: (message: string) => boolean;
};
// ^^^

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

function maybeResolve<E extends EventName>(event: E, ...args: ParametersFor<E>) {
    const containers = EVENT_CONTAINERS[event];

    // FIFO
    for (let i = 0; i < containers.length; ) {
        const container = containers[i];

        // @ts-ignore
        if (container.check(...args)) {
            container.remaining--;

            if (container.remaining <= 0) {
                container.resolve(args);
                containers.splice(i, 1);
                continue;
            }
        }

        i++;
    }
}

register("tick", () => {
    maybeResolve("tick");
});

export let lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero: number = 0;

function maybeUpdateWindowID(packet: Packet) {
    if (!(packet instanceof S30PacketWindowItems)) {
        return;
    }
    const windowID = packet.func_148911_c();
    if (windowID === 0) {
        return;
    }
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
