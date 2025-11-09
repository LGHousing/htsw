import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { Span } from "../../span";
import type { Spanned } from "../../ir";

export function nodeSpan(node: json.Node): Span {
    return new Span(node.offset, node.offset + node.length);
}

export function withNodeSpan<T>(value: T, node: json.Node): Spanned<T> {
    return { value, span: nodeSpan(node) };
}

export function parseString(gcx: GlobalCtxt, node: json.Node): string {
    if (node.type !== "string") {
        throw Diagnostic.error(`Expected string`)
            .addPrimarySpan(nodeSpan(node));
    }

    return node.value as string;
}

export function parseNumber(gcx: GlobalCtxt, node: json.Node): number {
    if (node.type !== "number") {
        throw Diagnostic.error(`Expected number`)
            .addPrimarySpan(nodeSpan(node));
    }

    return node.value as number;
}

export function parseBoundedNumber(
    min: number, max: number
): (gcx: GlobalCtxt, node: json.Node) => number {
    return (gcx: GlobalCtxt, node: json.Node): number => {
        const value = parseNumber(gcx, node);

        if (value < min) {
            gcx.addDiagnostic(
                Diagnostic.error(`Value must be greater than or equal to ${min}`)
                    .addPrimarySpan(nodeSpan(node))
            );
        }
        if (value > max) {
            gcx.addDiagnostic(
                Diagnostic.error(`Value must be less than or equal to ${max}`)
                    .addPrimarySpan(nodeSpan(node))
            );
        }

        return value;
    }
}

export function parseArray<T>(
    gcx: GlobalCtxt,
    node: json.Node,
    parser: (node: json.Node) => T
): T[] {
    const res: T[] = [];

    if (node.type !== "array" || !node.children) {
        throw Diagnostic.error("Expected array")
            .addPrimarySpan(nodeSpan(node));
    }

    for (const child of node.children) {
        if (!child) continue;
        try {
            const value = parser(child);
            res.push(value);
        } catch (e) {
            if (e instanceof Diagnostic) {
                gcx.addDiagnostic(e);
            }
        }
    }

    return res;
}

type NodeParseTree = { 
    [key: string]: NodeParseTreeElement;
};

type NodeParseTreeElement = { 
    required: boolean,
    parser: (node: json.Node) => void
};

export function parseObject(
    gcx: GlobalCtxt,
    node: json.Node,
    tree: NodeParseTree
) {
    if (node.type !== "object" || !node.children) {
        gcx.addDiagnostic(
            Diagnostic.error("Expected object")
                .addPrimarySpan(nodeSpan(node))
        );
        return;
    }

    const seenKeys = new Map<string, json.Node>();
    const requiredKeys = new Set(
        Object.entries(tree)
            .filter(([_, elem]) => elem.required)
            .map(([key]) => key)
    );

    for (const child of node.children) {
        if (child.type !== "property" || !child.children || child.children.length < 2) {
            gcx.addDiagnostic(
                Diagnostic.error("Invalid property node")
                    .addPrimarySpan(nodeSpan(child))
            );
            continue;
        }

        const keyNode = child.children[0];
        const valueNode = child.children[1];

        if (keyNode.type !== "string") {
            gcx.addDiagnostic(
                Diagnostic.error("Property key must be a string")
                    .addPrimarySpan(nodeSpan(keyNode))
            );
            continue;
        }

        const key = keyNode.value as string;

        if (seenKeys.has(key)) {
            gcx.addDiagnostic(
                Diagnostic.warning(`Duplicate key '${key}'`)
                    .addPrimarySpan(nodeSpan(keyNode))
            );
        } else {
            seenKeys.set(key, child);
        }

        const element = tree[key];
        if (element) {
            element.parser(valueNode);
            requiredKeys.delete(key);
        } else {
            gcx.addDiagnostic(
                Diagnostic.error(`Unknown key '${key}'`)
                    .addPrimarySpan(nodeSpan(keyNode))
            );
        }
    }

    for (const missingKey of requiredKeys) {
        gcx.addDiagnostic(
            Diagnostic.error(`Missing required key '${missingKey}'`)
                .addPrimarySpan(nodeSpan(node).endSpan())
        );
    }
}
