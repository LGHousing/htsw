import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { IrAction } from "../../ir";
import type { GlobalCtxt } from "../../context";

export function parseHtsl(ctx: GlobalCtxt, path: string): IrAction[] {
    const file = ctx.sourceMap.getFile(path);
    const lexer = new Lexer(file);
    const parser = new Parser(ctx, lexer);

    return parser.parseCompletely();
}