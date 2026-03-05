import type { Runtime } from "../runtime";

export type Behavior<T, R = void> = (runtime: Runtime, node: T) => R;

type Node = { type: string };
type NodeForKey<T extends Node, K extends string> =
    Extract<T, { type: K }> extends never
        ? T
        : Extract<T, { type: K }>;

type BehaviorMap<T extends Node, R> = Partial<{
    [K in T["type"]]: (runtime: Runtime, node: NodeForKey<T, K>) => R;
}>;

export class Behaviors<T extends Node, R> {
    private readonly handlers: BehaviorMap<T, R> = {};

    with<K extends T["type"]>(
        type: K,
        behavior: (runtime: Runtime, node: NodeForKey<T, K>) => R,
    ): this {
        this.handlers[type] = behavior;
        return this;
    }

    get<K extends T["type"]>(
        type: K,
    ): ((runtime: Runtime, node: NodeForKey<T, K>) => R) | undefined {
        return this.handlers[type];
    }

    dispatch(runtime: Runtime, node: T): R | undefined {
        for (const type of Object.keys(this.handlers) as T["type"][]) {
            const behavior = this.handlers[type];
            if (!behavior) continue;
            if (node.type === type) {
                return behavior(runtime, node as NodeForKey<T, typeof type>);
            }
        }
        return undefined;
    }
}
