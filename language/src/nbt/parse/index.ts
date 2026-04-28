import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Tag } from "../types";
import { Lexer } from "./lexer";
import { Parser } from "./parser";

export { Lexer } from "./lexer";
export * from "./token";

export function parseSnbt(gcx: GlobalCtxt, path: string): Tag | undefined {
    try {
        const file = gcx.sourceMap.getFile(path);
        const parser = new Parser(gcx, new Lexer(file.src, file.startPos));
        const tag = parser.parseCompletely();
        return tag;
    } catch (e) {
        if (e instanceof Diagnostic) {
            gcx.addDiagnostic(e);
        } else if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path}`));
        }
        return undefined;
    }
}
