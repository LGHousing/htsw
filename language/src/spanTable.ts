import type { Span } from "./span";

export type SpanTableFieldKey = string | number;

export class SpanTable {
    private readonly nodeSpans = new WeakMap<object, Span>();
    private readonly fieldSpans = new WeakMap<object, Map<SpanTableFieldKey, Span>>();

    setNodeSpan(node: object, span: Span): void {
        this.nodeSpans.set(node, span);
    }

    getNodeSpan(node: object): Span | undefined {
        return this.nodeSpans.get(node);
    }

    setFieldSpan(node: object, key: SpanTableFieldKey, span: Span): void {
        let map = this.fieldSpans.get(node);
        if (!map) {
            map = new Map();
            this.fieldSpans.set(node, map);
        }
        map.set(key, span);
    }

    getFieldSpan(node: object, key: SpanTableFieldKey): Span | undefined {
        return this.fieldSpans.get(node)?.get(key);
    }
}
