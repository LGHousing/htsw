import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { IrAction } from "../../ir";
import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { check } from "../typecheck/check";
import { TyCtxt } from "../typecheck/context";

export function parseHtsl(gcx: GlobalCtxt, path: string): IrAction[] {
    try {
        const file = gcx.sourceMap.getFile(path);
        const lexer = new Lexer(file);
        const parser = new Parser(gcx, lexer);

        const actions = parser.parseCompletely();
        const tcx = TyCtxt.fromGlobalCtxt(gcx);
        check(tcx, actions);
        return actions;
    } catch (e) {
        if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occured parsing ${path}`));
        }
        return [];
    }
}