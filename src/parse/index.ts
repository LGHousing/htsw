import { Lexer } from "./lexer";
import { Parser } from "./parser";
import type { ParseResult } from "../ir";
import { validate } from "../validate";
import type { SourceMap } from "../source";

export function parseFromString(src: string): ParseResult {
    const lexer = new Lexer(src, 0);
    const parser = new Parser(lexer);
    const result = parser.parseCompletely();
    validate(result);
    return result;
}

export function parseFromSourceMap(sm: SourceMap): ParseResult {
    let offset = 0;
    const result: ParseResult = {
        holders: [],
        diagnostics: [],
    };
    for (const file of sm.files) {
        const lexer = new Lexer(file.src, 0);
        const parser = new Parser(lexer);
        const { holders, diagnostics } = parser.parseCompletely();
        result.holders.push(...holders);
        result.diagnostics.push(...diagnostics);

        offset += file.src.length;
    }
    validate(result);
    return result;
}
