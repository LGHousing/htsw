import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Importable } from "../../types";
import { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import { parseImportableCommand, parseImportableEvent, parseImportableFunction, parseImportableGroup, parseImportableItem, parseImportableMenu, parseImportableNpc, parseImportableRegion, parseImportableTeam } from "./importables";
import { getFileName, warnUnused } from "./helpers";
import type { ImportJsonFileNode, ImportJsonParseMetadata } from "../metadata";
import type { RawImportJson } from "../schemaSpec";
import { optionalRawField, parseRawFields } from "./rawFields";

type IncludeOrigin = {
    includeParser: Parser;
    includePath: string;
    fromNode: ImportJsonFileNode;
};

const HOUSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseImportJson(
    gcx: GlobalCtxt,
    path: string,
    metadata: ImportJsonParseMetadata,
    origin?: IncludeOrigin
): Importable[] {
    const resolvedPath = resolveImportJsonPath(gcx, path);
    if (!prepareImportJsonParsing(gcx, metadata, resolvedPath, origin)) return [];

    const fileNode = metadata.beginFile(resolvedPath, origin?.fromNode);

    try {
        const file = gcx.sourceMap.getFile(resolvedPath);
        const tree = json.parseTree(file.src);

        if (tree === undefined) {
            gcx.addDiagnostic(Diagnostic.error(`Couldn't parse file '${resolvedPath}'`));
            return [];
        }

        const parser = new Parser(gcx, file.startPos, tree, metadata);
        const importables = parseImportJson0(parser, fileNode);
        gcx.importables.push(...importables);
        return importables;
    } catch (e) {
        if (e instanceof Diagnostic) {
            gcx.addDiagnostic(e);
        } else if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${path}`));
        }
        return [];
    }
}

function parseImportJson0(p: Parser, fileNode: ImportJsonFileNode): Importable[] {
    const importables: Importable[] = [];
    parseRawFields<RawImportJson>(p, {
        houseUuid: optionalRawField((field) =>
            parseHouseUuid(field, p.importJson.fileTree === fileNode)
        ),
        include: optionalRawField((field) =>
            parseEntryList(field, (entry) => {
                parseInclude(entry, fileNode);
            })
        ),
        functions: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableFunction)
        ),
        events: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableEvent)
        ),
        regions: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableRegion)
        ),
        items: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableItem)
        ),
        menus: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableMenu)
        ),
        teams: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableTeam)
        ),
        groups: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableGroup)
        ),
        commands: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableCommand)
        ),
        npcs: optionalRawField((field) =>
            pushParsedEntries(field, importables, parseImportableNpc)
        ),
    });

    warnUnused(p);
    for (const importable of importables) {
        if (importable.sourcePath === undefined) importable.sourcePath = fileNode.path;
    }
    p.importJson.recordImportables(fileNode, importables);
    return importables;
}

function pushParsedEntries<T extends Importable>(
    field: Parser,
    out: Importable[],
    parseEntry: (p: Parser) => T
): void {
    parseEntryList(field, (sp) => {
        out.push(parseEntry(sp));
    });
}

function parseEntryList(
    field: Parser,
    parseEntry: (p: Parser) => void | undefined
): void {
    let entries: Parser[];
    try {
        entries = field.parseArray();
    } catch (e) {
        addParseFailureDiagnostic(field, e);
        return;
    }

    for (const sp of entries) {
        try {
            parseEntry(sp);
        } catch (e) {
            addParseFailureDiagnostic(field, e);
        }
    }
}

function addParseFailureDiagnostic(p: Parser, e: unknown): void {
    if (e instanceof Diagnostic) {
        p.gcx.addDiagnostic(e);
    } else if (e instanceof Error) {
        p.gcx.addDiagnostic(Diagnostic.bugFromError(e));
    } else {
        p.gcx.addDiagnostic(Diagnostic.bug("An unknown error occurred parsing an import.json entry"));
    }
}

function parseHouseUuid(p: Parser, isEntryFile: boolean): void {
    if (!isEntryFile) {
        return;
    }
    const uuid = p.parseString();
    if (!HOUSE_UUID_RE.test(uuid)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Expected UUID").addPrimarySpan(p.span())
        );
        return;
    }
    p.importJson.houseUuid = uuid.toLowerCase();
}

function parseInclude(
    p: Parser,
    fileNode: ImportJsonFileNode
): Importable[] {
    const path = p.parseString();

    if (
        !path.endsWith("import.json") &&
        !path.endsWith(".import.json")
    ) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Invalid import file")
                .addPrimarySpan(p.span(), "Expected an `import.json` file")
        );
        return [];
    }

    const resolved = resolveRelativePath(p.gcx, fileNode.path, path);
    return parseImportJson(
        p.gcx.subContext(resolved),
        resolved,
        p.importJson,
        { includeParser: p, includePath: path, fromNode: fileNode }
    );
}

function prepareImportJsonParsing(
    gcx: GlobalCtxt,
    metadata: ImportJsonParseMetadata,
    resolvedPath: string,
    origin?: IncludeOrigin
): boolean {
    if (metadata.hasVisited(resolvedPath)) {
        if (origin !== undefined) metadata.recordReference(origin.fromNode, resolvedPath);
        return false;
    }
    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        if (origin !== undefined) metadata.recordMissing(origin.fromNode, resolvedPath);
        const fileName = getFileName(resolvedPath);
        const diag = origin === undefined
            ? Diagnostic.error(`import.json file does not exist '${resolvedPath}'`)
            : Diagnostic.error(`Couldn't read \`${fileName}\` file`)
                .addPrimarySpan(
                    origin.includeParser.span(),
                    "No such file"
                );
        gcx.addDiagnostic(diag);
        return false;
    }
    return true;
}

function resolveImportJsonPath(gcx: GlobalCtxt, path: string): string {
    if (gcx.sourceMap.fileLoader.fileExists(path)) return path;
    return gcx.resolvePath(path);
}

function resolveRelativePath(gcx: GlobalCtxt, currentPath: string, path: string): string {
    return gcx.sourceMap.fileLoader.resolvePath(
        gcx.sourceMap.fileLoader.getParentPath(currentPath),
        path
    );
}
