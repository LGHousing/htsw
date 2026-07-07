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
    const importables: Importable[] = []

    for (const sp of p.parseFieldOrUndefined("include")?.parseArray() ?? []) {
        parseInclude(sp, fileNode);
    }

    parseHouseUuid(p, p.importJson.fileTree === fileNode);

    for (const sp of p.parseFieldOrUndefined("functions")?.parseArray() ?? []) {
        importables.push(parseImportableFunction(sp));
    } 

    for (const sp of p.parseFieldOrUndefined("regions")?.parseArray() ?? []) {
        importables.push(parseImportableRegion(sp));
    }

    for (const sp of p.parseFieldOrUndefined("menus")?.parseArray() ?? []) {
        importables.push(parseImportableMenu(sp));
    }

    for (const sp of p.parseFieldOrUndefined("items")?.parseArray() ?? []) {
        importables.push(parseImportableItem(sp));
    }

    for (const sp of p.parseFieldOrUndefined("npcs")?.parseArray() ?? []) {
        importables.push(parseImportableNpc(sp));
    }

    for (const sp of p.parseFieldOrUndefined("events")?.parseArray() ?? []) {
        importables.push(parseImportableEvent(sp));
    }

    for (const sp of p.parseFieldOrUndefined("groups")?.parseArray() ?? []) {
        importables.push(parseImportableGroup(sp));
    }

    for (const sp of p.parseFieldOrUndefined("teams")?.parseArray() ?? []) {
        importables.push(parseImportableTeam(sp));
    }

    for (const sp of p.parseFieldOrUndefined("commands")?.parseArray() ?? []) {
        importables.push(parseImportableCommand(sp));
    }

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
