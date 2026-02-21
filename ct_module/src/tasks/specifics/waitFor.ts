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

function maybeResolve<E extends EventName>(
    event: E,
    ...args: ParametersFor<E>
) {
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
register("packetReceived", (packet) => {
    maybeResolve("packetReceived", packet);
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

export function waitFor<E extends EventName>(
    event: E,
    check: CheckPredicateMap[E] | null = null,
    amount: number = 1,
): Promise<ParametersFor<E>> {
    if (check === null) {
        check = () => true;
    }

    return new Promise<ParametersFor<E>>((resolve) => {
        const container: ContainerFor<E> = {
            check: check,
            resolve,
            remaining: amount,
        };

        EVENT_CONTAINERS[event].push(container);
    });
}
