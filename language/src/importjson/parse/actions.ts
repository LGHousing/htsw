import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Action } from "../../types";
import { nodeSpan, parseString } from "./helpers";
import { parseHtsl } from "../../htsl";
import { Diagnostic } from "../../diagnostic";

export function parseActions(gcx: GlobalCtxt, node: json.Node): Action[] {
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
    
    return parseHtsl(gcx, resolvedPath);
}
