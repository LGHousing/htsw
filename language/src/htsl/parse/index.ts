import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";

export function parseHtsl(gcx: GlobalCtxt, path: string): Action[] {
    try {
        const file = gcx.sourceMap.getFile(path);
        const lexer = new Lexer(file);
        const parser = new Parser(gcx, lexer);

        return parser.parseCompletely();
    } catch (e) {
        if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path}`));
        }
        return [];
    }
}
