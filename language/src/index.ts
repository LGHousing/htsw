import { check } from "./check";
import { GlobalCtxt } from "./context";
import type { Diagnostic } from "./diagnostic";
import { parseHtsl } from "./htsl";
import { parseImportJson } from "./importjson";
import { ImportJsonParseMetadata } from "./importjson/metadata";
import { importableFilePaths } from "./importablePaths";
import { SourceMap, type FileLoader } from "./sourceMap";
import type { SpanTable } from "./spanTable";
import type { Action, Importable } from "./types";

export * from "./sourceMap";
export * from "./context";
export * from "./diagnostic";
export * from "./span";
export * from "./spanTable";
export * from "./long";
export * from "./importjson/metadata";
export * from "./importablePaths";
export * from "./diagnosticAttribution";
export { isUnspawnableItem } from "./check/unspawnableItems";

export * as types from "./types";
export * as helpers from "./helpers"

export * as htsl from "./htsl";
export * as importjson from "./importjson";
export * as nbt from "./nbt";
export * as items from "./items";
export * as runtime from "./runtime";

export const VERSION = "v1.0.2";

export type ParseResult<T> = {
    value: T;
    spans: SpanTable;
    diagnostics: Diagnostic[];
    gcx: GlobalCtxt;
};

export type ImportablesParseResult = ParseResult<Importable[]> & {
    importJson: ImportJsonParseMetadata;
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
): ImportablesParseResult {
    const gcx = new GlobalCtxt(sm, path);
    const importJson = new ImportJsonParseMetadata();
    parseImportJson(gcx, path, importJson);
    importJson.rehomeFileTree();
    const filesWithParseErrors = new Set<string>();
    for (const diagnostic of gcx.diagnostics) {
        if (diagnostic.level !== "error" && diagnostic.level !== "bug") continue;
        const primary = diagnostic.spans.find(span => span.kind === "primary") ?? diagnostic.spans[0];
        if (primary === undefined) continue;
        try {
            filesWithParseErrors.add(gcx.sourceMap.getFileByPos(primary.span.start).path);
        } catch (_error) {}
    }
    check(gcx, gcx.importables.filter(importable =>
        importableFilePaths(importable).every(file => !filesWithParseErrors.has(file))
    ));
    return {
        value: gcx.importables,
        spans: gcx.spans,
        diagnostics: gcx.diagnostics,
        gcx,
        importJson
    };
}

export function parseImportables(
    fileLoader: FileLoader,
    path: string,
): Importable[] {
    const sm = new SourceMap(fileLoader);
    return parseImportablesResult(sm, path).value;
}
