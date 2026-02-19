import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { Span } from "../../span";
import type { Ir, Spanned } from "../../ir";
import type { Bounds, Pos } from "../../types";

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
        try {
            const value = parser(child);
            res.push(value);
        } catch (e) {
            if (e instanceof Diagnostic) {
                gcx.addDiagnostic(e);
                continue;
            }
            throw e;
        }
    }

    return res;
}

/**
 * Attempts to match and return a value from a list of valid options.
 *
 * Matching is case-insensitive.
 * 
 * @param options A list of valid option strings.
 * @param errorFormatting Terms used when generating error messages.
 * @returns The parsed option in its canonical form from the `options` list.
 */
export function parseOption<T extends string>(
    gcx: GlobalCtxt,
    node: json.Node,
    options: readonly T[],
    errorTerms?: { singular: string, plural: string },
): T {
    const value = parseString(gcx, node);
    for (const option of options) {
        if (value.toLowerCase() === option.toLowerCase()) return option;
    }

    const err = Diagnostic.error(`Expected ${errorTerms?.singular ?? "option"}`)
        .addPrimarySpan(nodeSpan(node));

    function addHelp(message: string) {
        err.addSubDiagnostic(Diagnostic.help(message));
    }

    addHelp(`Valid ${errorTerms?.plural ?? "options"} are:`)

    const optionsToDisplay = Math.min(5, options.length);
    for (let i = 0; i < optionsToDisplay; i++) {
        addHelp(`  ${options[i]}`);
    }

    if (options.length > 5) {
        addHelp(`And ${options.length - 5} others`);
    }

    throw err;
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
            const diag = Diagnostic.error(`Unknown key '${key}'`)
                .addPrimarySpan(nodeSpan(keyNode));

            const validKeys = Object.keys(tree);
            if (validKeys.length > 0) {
                diag.addSubDiagnostic(
                    Diagnostic.help(`Valid keys are: ${validKeys.join(", ")}`)
                );
            }

            gcx.addDiagnostic(diag);
        }
    }

    for (const missingKey of requiredKeys) {
        const diag = Diagnostic.error(`Missing required key '${missingKey}'`)
            .addPrimarySpan(nodeSpan(node).endSpan());

        const validKeys = Object.keys(tree);
        if (validKeys.length > 0) {
            diag.addSubDiagnostic(
                Diagnostic.help(`Allowed keys here: ${validKeys.join(", ")}`)
            );
        }

        gcx.addDiagnostic(diag);
    }
}

export function parseBoolean(gcx: GlobalCtxt, node: json.Node): boolean {
    if (node.type !== "boolean") {
        throw Diagnostic.error("Expected boolean")
            .addPrimarySpan(nodeSpan(node));
    }

    return node.value as boolean;
}

export function parseIrBounds(gcx: GlobalCtxt, node: json.Node): Ir<Bounds> {
    let from: Spanned<Ir<Pos>> | undefined;
    let to: Spanned<Ir<Pos>> | undefined;
    
    parseObject(gcx, node, {
       "from": {
           required: true,
           parser: (node) => {
               from = withNodeSpan(parseIrPos(gcx, node), node);
           }
       },
       "to": {
           required: true,
           parser: (node) => {
               to = withNodeSpan(parseIrPos(gcx, node), node);
           }
       }
    });
    
    return { from, to };
}

export function parseIrPos(gcx: GlobalCtxt, node: json.Node): Ir<Pos> {
    let x: Spanned<number> | undefined;
    let y: Spanned<number> | undefined;
    let z: Spanned<number> | undefined;
    
    parseObject(gcx, node, {
       "x": {
           required: true,
           parser: (node) => {
               x = withNodeSpan(parseNumber(gcx, node), node);
           }
       },
       "y": {
           required: true,
           parser: (node) => {
               y = withNodeSpan(parseNumber(gcx, node), node);
           }
       },
       "z": {
           required: true,
           parser: (node) => {
               z = withNodeSpan(parseNumber(gcx, node), node);
           }
       }
    });
    
    return { x, y, z };
}
