// Client module: declared here, implemented by the client (ct_module/src/tasks/specifics/waitFor.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { Packet } from "../../platform";

// The event types you can wait on, and the predicate signature each one
// checks against. Call as `waitFor(eventName, optionalPredicate)`.
type CheckPredicateMap = {
    tick: () => boolean;
    packetReceived: (packet: Packet) => boolean;
    packetSent: (packet: Packet) => boolean;
    message: (message: string) => boolean;
};

type EventName = keyof CheckPredicateMap;

type ParametersFor<E extends EventName> = Parameters<CheckPredicateMap[E]>;

export type WaitForPromise<T> = Promise<T> & {
    cleanupWaiter?: () => void;
};

export declare function describeRecentWindowOpens(): string;
export declare function setPacketCaptureForTask(active: boolean): void;
export declare function resetEventContainers(): number;
export declare function waitForTimeout(
    reason: string,
    duration: number,
    isCancelled: () => boolean,
    cleanupInner?: () => void
): WaitForPromise<never>;
export declare function waitFor<E extends EventName>(
    event: E,
    check?: CheckPredicateMap[E] | null,
    amount?: number
): WaitForPromise<ParametersFor<E>>;
