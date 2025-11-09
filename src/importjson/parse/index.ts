import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { IrAction, IrImportable, Spanned } from "../../ir";
import { nodeSpan, parseArray, parseBoundedNumber, parseObject, parseString, withNodeSpan } from "./helpers";
import { parseActions } from "./actions";
import { Span } from "../../span";

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
        }
    });
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