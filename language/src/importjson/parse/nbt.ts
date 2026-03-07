import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { nodeSpan, parseString } from "./helpers";
import { parseSnbt, type Tag } from "../../nbt";

export function parseNbt(gcx: GlobalCtxt, node: json.Node): Tag {
    const filePath = parseString(gcx, node);

    if (!filePath.endsWith(".snbt")) {
        throw Diagnostic.error("Expected SNBT file")
            .addPrimarySpan(nodeSpan(node), "Invalid extension");
    }

    if (!gcx.fileExists(filePath)) {
        throw Diagnostic.error("SNBT file does not exist")
            .addPrimarySpan(nodeSpan(node), "Not found");
    }

    const resolvedPath = gcx.resolvePath(filePath);
    const tag = parseSnbt(gcx, resolvedPath);

    if (tag === undefined) {
        // parseSnbt should, by invariant, emit diagnostics before returning
        // undefined. But I'm super fucking paranoid of importing invalid items
        // after getting banned for it, so we have this beautiful check:
        if (!gcx.isFailed()) throw Error("This should NEVER happen");

        // We're probably fine now :) fallback value
        return { "type": "compound", "value": {} };
    }
    
    return tag;
}