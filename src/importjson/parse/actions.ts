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
            .addPrimarySpan(nodeSpan(node), "Invalid extension");
    }

    if (!gcx.fileExists(path)) {
        throw Diagnostic.error("HTSL file does not exist")
            .addPrimarySpan(nodeSpan(node), "Not found");
    }
    
    const resolvedPath = gcx.resolvePath(path);
    
    return parseHtsl(gcx, resolvedPath);
}

export function parseSnbt(gcx: GlobalCtxt, node: json.Node): string {
    const path = parseString(gcx, node);

    if (!path.endsWith(".snbt")) {
        throw Diagnostic.error("File must have .snbt extension")
            .addPrimarySpan(nodeSpan(node), `Expected .snbt file, got '${path}'`);
    }

    if (!gcx.fileExists(path)) {
        throw Diagnostic.error(`SNBT file not found: ${path}`)
            .addPrimarySpan(nodeSpan(node), "File does not exist");
    }
    
    return gcx.readFile(path);
}