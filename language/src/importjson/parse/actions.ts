import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Action } from "../../types";
import { nodeSpan, parseString } from "./helpers";
import { parseHtsl } from "../../htsl";
import { Diagnostic } from "../../diagnostic";

export type ParsedActions = {
    actions: Action[];
    /** Resolved absolute path of the .htsl file the actions came from. */
    resolvedPath: string;
};

export function parseActions(gcx: GlobalCtxt, node: json.Node): Action[] {
    return parseActionsWithPath(gcx, node).actions;
}

export function parseActionsWithPath(gcx: GlobalCtxt, node: json.Node): ParsedActions {
    const path = parseString(gcx, node);

    if (!path.endsWith(".htsl")) {
        throw Diagnostic.error("Expected HTSL file")
            .addPrimarySpan(nodeSpan(node), "Invalid extension")
    }

    if (!gcx.fileExists(path)) {
        throw Diagnostic.error("HTSL file does not exist")
            .addPrimarySpan(nodeSpan(node), "Not found")
    }

    const resolvedPath = gcx.resolvePath(path);

    return { actions: parseHtsl(gcx, resolvedPath), resolvedPath };
}
