import { Lexer } from './lexer';
import { Parser } from './parser';
import type { ParseResult } from '../ir';
import { validate } from '../validate';

export function parseFromString(src: string): ParseResult {
    const lexer = new Lexer(src);
    const parser = new Parser(lexer);
    const result = parser.parseCompletely();
    validate(result);
    return result;
}
