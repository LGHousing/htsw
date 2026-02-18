type Packet = MCPacket<MCINetHandler>;

// this is only important one, use like `waitFor(key, [value])`
type PredicateMap = {
    tick: () => boolean;
    packetReceived: (packet: Packet) => boolean;
    packetSent: (packet: Packet) => boolean;
    message: (message: string) => boolean;
};
// ^^^

type EventContainer<P extends (...args: any[]) => boolean> = {
    predicate: P;
    resolve: (value: Parameters<P>) => void;
    remaining: number;
};

type EventContainers = {
    [K in keyof PredicateMap]: EventContainer<PredicateMap[K]>[];
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
        if (container.predicate(...args)) {
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

type EventName = keyof PredicateMap;

type ContainerFor<E extends EventName> = EventContainers[E][number];
type ParametersFor<E extends EventName> = Parameters<PredicateMap[E]>;

export function waitFor<E extends EventName>(
    event: E,
    predicate: PredicateMap[E] | null = null,
    amount: number = 1
): Promise<ParametersFor<E>> {
    if (predicate === null) {
        predicate = () => true;
    }

    return new Promise<ParametersFor<E>>((resolve) => {
        const container: ContainerFor<E> = {
            predicate,
            resolve,
            remaining: amount,
        };

        EVENT_CONTAINERS[event].push(container);
    });
}
