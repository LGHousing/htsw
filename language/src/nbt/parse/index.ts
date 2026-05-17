import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { SpanTable } from "../../spanTable";
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

/**
 * Parse a raw SNBT string into a `Tag`, with no source-file or
 * diagnostic-routing dependencies. Throws the underlying `Diagnostic`
 * on a parse failure rather than collecting it.
 *
 * Use case: tools that already have SNBT text in hand (e.g., Minecraft's
 * `getRawNBT()` output in the ChatTriggers module) and want a `Tag` so
 * they can pipe through `printSnbt(tag, { pretty: true })` for canonical
 * pretty output. The path-based `parseSnbt(gcx, path)` above is for
 * consumers integrated with `SourceMap` + diagnostic collection; this
 * one is the bare-string counterpart.
 *
 * Implementation: the parser only needs `gcx.spans` (a `SpanTable` for
 * recording source ranges of parsed nodes) — diagnostics propagate via
 * thrown `Diagnostic` exceptions out of `parseCompletely`. We supply a
 * private `SpanTable` so the parser's `setField`/`get` paths work, and
 * stub `addDiagnostic` to rethrow so callers can wrap in their own
 * `try/catch` if they want. Other `GlobalCtxt` fields go unused.
 */
export function parseSnbtText(text: string): Tag {
    const spans = new SpanTable();
    const gcxStub = {
        spans,
        addDiagnostic(diag: Diagnostic): void {
            throw diag;
        },
    } as unknown as GlobalCtxt;
    return new Parser(gcxStub, new Lexer(text, 0)).parseCompletely();
}
