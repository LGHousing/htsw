import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

let parsedResult: ParseResult<Importable[]> | null = null;

export function getParsedResult(): ParseResult<Importable[]> | null {
    return parsedResult;
}
export function setParsedResult(r: ParseResult<Importable[]> | null): void {
    parsedResult = r;
}
