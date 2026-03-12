import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { check } from "../check";

export function parseHtsl(gcx: GlobalCtxt, path: string): Action[] {
    try {
        const file = gcx.sourceMap.getFile(path);
        const lexer = new Lexer(file);
        const parser = new Parser(gcx, lexer);

        const actions = parser.parseCompletely();
        check(gcx, actions);
        return actions;
    } catch (e) {
        if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path}`));
        }
        return [];
    }
}
