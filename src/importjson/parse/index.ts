import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Ir, IrAction, IrImportable, Spanned } from "../../ir";
import { nodeSpan, parseArray, parseBoundedNumber, parseIrBounds, parseObject, parseOption, parseString, withNodeSpan } from "./helpers";
import { parseActions } from "./actions";
import { Span } from "../../span";
import { EVENTS, type Bounds, type Event } from "../../types";

export function parseImportJson(gcx: GlobalCtxt, path: string) {
    try {
        const file = gcx.sourceMap.getFile(path);
        const tree = json.parseTree(file.src);

        if (!tree) {
            gcx.addDiagnostic(
                Diagnostic.error(`Couldn't parse file '${path}'`)
            );
            return;
        }

        parseImportJson0(gcx, tree);
    } catch (e) {
        if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occured parsing ${path}`));
        }
    }
}

function parseImportJson0(gcx: GlobalCtxt, node: json.Node) {    
    parseObject(gcx, node, {
        "functions": {
            required: false,
            parser: (node) => {
                gcx.importables.push(...parseArray(gcx, node, (node) => {
                    return parseImportableFunction(gcx, node);
                }));
            }
        },
        "events": {
            required: false,
            parser: (node) => {
                gcx.importables.push(...parseArray(gcx, node, (node) => {
                    return parseImportableEvent(gcx, node);
                }));
            }
        },
        "regions": {
            required: false,
            parser: (node1) => {
                gcx.importables.push(...parseArray(gcx, node1, (node2) => {
                    return parseImportableRegion(gcx, node2);
                }));
            }
        }
    });

    const hasErrors = gcx.diagnostics.find(
        it => it.level === "error" || it.level === "bug"
    ) !== undefined;

    if (!hasErrors && gcx.importables.length === 0) {
        gcx.addDiagnostic(
            Diagnostic.warning("No importables found")
                .addPrimarySpan(nodeSpan(node), "Empty import.json")
        );
    }
}

function parseImportableFunction(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let name: Spanned<string> | undefined;
    let actions: Spanned<IrAction[]> | undefined;
    let repeatTicks: Spanned<number> | undefined;

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (node) => {
                name = withNodeSpan(parseString(gcx, node), node);
            }
        },
        "actions": {
            required: true,
            parser: (node) => {
                actions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "repeatTicks": {
            required: true,
            parser: (node) => {
                repeatTicks = withNodeSpan(parseBoundedNumber(4, 18000)(gcx, node), node);
            }
        },
    });

    return {
        type: "FUNCTION",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        name, actions, repeatTicks
    };
}

function parseImportableEvent(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let event: Spanned<Event> | undefined;
    let actions: Spanned<IrAction[]> | undefined;
    
    parseObject(gcx, node, {
        "event": {
            required: true,
            parser: (node) => {
                event = withNodeSpan(
                    parseOption(gcx, node, EVENTS, { singular: "event", plural: "events" }),
                    node
                );
            }
        },
        "actions": {
            required: true,
            parser: (node) => {
                actions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
    });
    
    return {
        type: "EVENT",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        event, actions
    };
}

function parseImportableRegion(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let name: Spanned<string> | undefined;
    let bounds: Spanned<Ir<Bounds>> | undefined;
    let onEnterActions: Spanned<IrAction[]> | undefined;
    let onExitActions: Spanned<IrAction[]> | undefined;
        
    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (node) => {
                name = withNodeSpan(parseString(gcx, node), node);
            }
        },
        "bounds": {
            required: false,
            parser: (node) => {
                bounds = withNodeSpan(parseIrBounds(gcx, node), node);
            }
        },
        "onEnterActions": {
            required: false,
            parser: (node) => {
                onEnterActions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "onExitActions": {
            required: false,
            parser: (node) => {
                onExitActions = withNodeSpan(parseActions(gcx, node), node);
            }
        }
    });
    
    return {
        type: "REGION",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        name, bounds, onEnterActions, onExitActions
    };
}
