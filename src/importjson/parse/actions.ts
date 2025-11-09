import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { IrAction } from "../../ir";
import { nodeSpan, parseString } from "./helpers";
import { parseHtsl } from "../../htsl";
import { Diagnostic } from "../../diagnostic";

export function parseActions(gcx: GlobalCtxt, node: json.Node): IrAction[] {
    const path = parseString(gcx, node);

    if (!path.endsWith(".htsl")) {
        throw Diagnostic.error("Expected HTSL file")
            .addPrimarySpan(nodeSpan(node), "Invalid extension")
    }

    if (!gcx.sourceMap.fileLoader.fileExists(path)) {
        throw Diagnostic.error("HTSL file does not exist")
            .addPrimarySpan(nodeSpan(node), "Not found")
    }

    return parseHtsl(gcx, path);
}