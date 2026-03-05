import type { Span } from "./span";

type Key = string | number | symbol;

export class SpanTable {
    private readonly nodeSpans = new WeakMap<object, Span>();
    private readonly fieldSpans = new WeakMap<object, Map<Key, Span>>();

    set<T extends object>(node: T, span: Span): void {
        this.nodeSpans.set(node, span);
    }

    get<T extends object>(node: T): Span {
        const span = this.nodeSpans.get(node);
        if (!span) throw Error(`Missing span for reference: ${node}`);
        return span;
    }

    setField<T extends object>(node: T, key: keyof T, span: Span): void {
        let map = this.fieldSpans.get(node);
        if (!map) {
            map = new Map();
            this.fieldSpans.set(node, map);
        }
        map.set(key, span);
    }

    getField<T extends object>(node: T, key: keyof T): Span {
        const span = this.fieldSpans.get(node)?.get(key);
        if (!span) throw Error(`Missing span for field ${String(key)} of reference: ${node}`);
        return span;
    }
}
