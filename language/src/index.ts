import { check } from "./check";
import { GlobalCtxt } from "./context";
import type { Diagnostic } from "./diagnostic";
import { parseHtsl } from "./htsl";
import { parseImportJson } from "./importjson";
import { SourceMap, type FileLoader } from "./sourceMap";
import type { SpanTable } from "./spanTable";
import type { Action, Importable } from "./types";

export * from "./sourceMap";
export * from "./context";
export * from "./diagnostic";
export * from "./span";
export * from "./spanTable";
export * from "./long";

export * as types from "./types";
export * as helpers from "./helpers"

export * as htsl from "./htsl";
export * as importjson from "./importjson";
export * as nbt from "./nbt";
export * as runtime from "./runtime";

export const VERSION = "v0.0.1-beta";

export type ParseResult<T> = {
    value: T;
    spans: SpanTable;
    diagnostics: Diagnostic[];
    gcx: GlobalCtxt;
};

export function parseActionsResult(
    sm: SourceMap,
    path: string,
): ParseResult<Action[]> {
    const gcx = new GlobalCtxt(sm, path);
    const actions = parseHtsl(gcx, path);
    return {
        value: actions,
        spans: gcx.spans,
        diagnostics: gcx.diagnostics,
        gcx
    };
}

export function parseActions(
    fileLoader: FileLoader,
    path: string,
): Action[] {
    const sm = new SourceMap(fileLoader);
    return parseActionsResult(sm, path).value;
}

export function parseImportablesResult(
    sm: SourceMap,
    path: string,
): ParseResult<Importable[]> {
    const gcx = new GlobalCtxt(sm, path);
    parseImportJson(gcx, path);
    check(gcx);
    return {
        value: gcx.importables,
        spans: gcx.spans,
        diagnostics: gcx.diagnostics,
        gcx
    };
}

export function parseImportables(
    fileLoader: FileLoader,
    path: string,
): Importable[] {
    const sm = new SourceMap(fileLoader);
    return parseImportablesResult(sm, path).value;
}
