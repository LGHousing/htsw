import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Importable } from "../../types";
import { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import { parseImportableCommand, parseImportableEvent, parseImportableFunction, parseImportableGroup, parseImportableItem, parseImportableMenu, parseImportableNpc, parseImportableRegion, parseImportableTeam } from "./importables";
import { getFileName, warnUnused } from "./helpers";
import type { ImportJsonFileNode, ImportJsonParseMetadata } from "../metadata";

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

    parseEntryList(p, "include", (sp) => {
        parseInclude(sp, fileNode);
        return undefined;
    });

    parseHouseUuid(p, p.importJson.fileTree === fileNode);

    pushParsedEntries(p, importables, "functions", parseImportableFunction);
    pushParsedEntries(p, importables, "regions", parseImportableRegion);
    pushParsedEntries(p, importables, "menus", parseImportableMenu);
    pushParsedEntries(p, importables, "items", parseImportableItem);
    pushParsedEntries(p, importables, "npcs", parseImportableNpc);
    pushParsedEntries(p, importables, "events", parseImportableEvent);
    pushParsedEntries(p, importables, "groups", parseImportableGroup);
    pushParsedEntries(p, importables, "teams", parseImportableTeam);
    pushParsedEntries(p, importables, "commands", parseImportableCommand);

    warnUnused(p, [
        "include", "houseUuid", "functions",
        "regions", "menus", "items", "npcs", "events", "groups",
        "teams", "commands"
    ]);
    for (const importable of importables) {
        if (importable.sourcePath === undefined) importable.sourcePath = fileNode.path;
    }
    p.importJson.recordImportables(fileNode, importables);
    return importables;
}

function pushParsedEntries<T extends Importable>(
    p: Parser,
    out: Importable[],
    fieldName: string,
    parseEntry: (p: Parser) => T
): void {
    parseEntryList(p, fieldName, (sp) => {
        out.push(parseEntry(sp));
        return undefined;
    });
}

function parseEntryList(
    p: Parser,
    fieldName: string,
    parseEntry: (p: Parser) => void | undefined
): void {
    const field = p.parseFieldOrUndefined(fieldName);
    if (field === undefined) return;

    let entries: Parser[];
    try {
        entries = field.parseArray();
    } catch (e) {
        addParseFailureDiagnostic(p, e);
        return;
    }

    for (const sp of entries) {
        try {
            parseEntry(sp);
        } catch (e) {
            addParseFailureDiagnostic(p, e);
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
    const field = p.parseFieldOrUndefined("houseUuid");
    if (field === undefined) return;
    if (!isEntryFile) {
        return;
    }
    const uuid = field.parseString();
    if (!HOUSE_UUID_RE.test(uuid)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Expected UUID").addPrimarySpan(field.span())
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
