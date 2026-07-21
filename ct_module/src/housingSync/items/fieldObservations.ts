import type { Action, Condition } from "htsw/types";

export type ItemFieldObservation = {
    snbt: string;
    canonicalKey: string;
};

export class ItemFieldObservationRecorder {
    private readonly byNode = new WeakMap<
        Action | Condition,
        Map<string, ItemFieldObservation>
    >();

    record(
        node: Action | Condition,
        prop: string,
        observation: ItemFieldObservation
    ): void {
        let fields = this.byNode.get(node);
        if (fields === undefined) {
            fields = new Map();
            this.byNode.set(node, fields);
        }
        fields.set(prop, observation);
    }

    get(node: Action | Condition, prop: string): ItemFieldObservation | undefined {
        return this.byNode.get(node)?.get(prop);
    }
}

export function createItemFieldObservationRecorder(): ItemFieldObservationRecorder {
    return new ItemFieldObservationRecorder();
}
