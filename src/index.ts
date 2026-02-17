import { GlobalCtxt } from "./context";
import type { Diagnostic } from "./diagnostic";
import { parseHtsl } from "./htsl";
import { parseImportJson } from "./importjson";
import { unwrapIr, type IrAction, type IrImportable } from "./ir";
import { SourceMap, type FileLoader } from "./sourceMap";
import type { Action, Importable } from "./types";

export * from "./sourceMap";
export * from "./context";
export * from "./diagnostic";

export * as types from "./types";
export * as ir from "./ir";
export * as helpers from "./helpers"

export * as htsl from "./htsl";
export * as importjson from "./importjson";

export const VERSION = "v0.0.1-beta";

export type ParseResult<T> = {
    value: T;
    diagnostics: Diagnostic[];
    gcx: GlobalCtxt;
};

export function parseIrActions(
    sm: SourceMap,
    path: string,
): ParseResult<IrAction[]> {
    const gcx = new GlobalCtxt(sm, path);
    const actions = parseHtsl(gcx, path);
    return { value: actions, diagnostics: gcx.diagnostics, gcx };
}

export function parseActions(
    fileLoader: FileLoader,
    path: string,
): Action[] {
    const sm = new SourceMap(fileLoader);
    return unwrapIr<Action[]>(
        parseIrActions(sm, path).value
    );
}

export function parseIrImportables(
    sm: SourceMap,
    path: string,
): ParseResult<IrImportable[]> {
    const gcx = new GlobalCtxt(sm, path);
    parseImportJson(gcx, path);
    return { value: gcx.importables, diagnostics: gcx.diagnostics, gcx };
}

export function parseImportables(
    fileLoader: FileLoader,
    path: string,
): Importable[] {
    const sm = new SourceMap(fileLoader);
    return unwrapIr<Importable[]>(
        parseIrImportables(sm, path).value
    );
}