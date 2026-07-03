import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Importable } from "../../types";
import { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import { parseImportableCommand, parseImportableEvent, parseImportableFunction, parseImportableGroup, parseImportableItem, parseImportableMenu, parseImportableNpc, parseImportableRegion, parseImportableTeam } from "./importables";
import { warnUnused } from "./helpers";
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
    } finally {
        metadata.endFile(resolvedPath);
    }
}

function parseImportJson0(p: Parser, fileNode: ImportJsonFileNode): Importable[] {
    const importables: Importable[] = []
    const seenIncludes = new Set<string>();

    for (const sp of p.parseFieldOrUndefined("include")?.parseArray() ?? []) {
        parseInclude(sp, fileNode, seenIncludes);
    }

    parseHouseUuid(p, fileNode.path);

    const houseName = p.parseFieldOrUndefined("houseName")?.parseString();
    if (houseName) importables.push({ type: "HOUSE_NAME", name: houseName });

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
        "include", "houseUuid", "houseName", "functions",
        "regions", "menus", "items", "npcs", "events", "groups",
        "teams", "commands"
    ]);
    for (const importable of importables) {
        if (p.importJson.sourcePathOf(importable) === undefined) {
            p.importJson.setSourcePath(importable, fileNode.path);
        }
    }
    p.importJson.recordImportables(fileNode, importables);
    return importables;
}

function parseHouseUuid(p: Parser, currentPath: string): void {
    const field = p.parseFieldOrUndefined("houseUuid");
    if (field === undefined) return;
    if (p.importJson.activeDepth() > 1) {
        p.gcx.addDiagnostic(
            Diagnostic.warning("'houseUuid' in an included import.json is ignored")
                .addPrimarySpan(field.span())
                .addSubDiagnostic(
                    Diagnostic.note(`only the entry import.json binds the parse to a house; this key applies when '${currentPath}' is parsed directly`)
                )
        );
        return;
    }
    const uuid = field.parseString();
    if (!HOUSE_UUID_RE.test(uuid)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Expected a housing UUID")
                .addPrimarySpan(field.span())
                .addSubDiagnostic(
                    Diagnostic.help("Housing UUIDs look like '01234567-89ab-cdef-0123-456789abcdef'")
                )
        );
        return;
    }
    p.importJson.houseUuid = uuid.toLowerCase();
}

function parseInclude(
    p: Parser,
    fileNode: ImportJsonFileNode,
    seenIncludes: Set<string>
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
    if (seenIncludes.has(resolved)) {
        p.gcx.addDiagnostic(
            Diagnostic.warning(`Duplicate include path '${path}'`)
                .addPrimarySpan(p.span(), `resolves to '${resolved}'`)
        );
        return [];
    }
    seenIncludes.add(resolved);

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
    if (metadata.isActive(resolvedPath)) {
        const diag = Diagnostic.error("Circular import.json include")
            .addSubDiagnostic(Diagnostic.note(metadata.cyclePath(resolvedPath)));
        if (origin !== undefined) {
            diag.addPrimarySpan(
                origin.includeParser.span(),
                `include '${origin.includePath}' resolves to '${resolvedPath}'`
            );
            diag.addSubDiagnostic(Diagnostic.note(`included from '${origin.fromNode.path}'`));
        }
        gcx.addDiagnostic(diag);
        return false;
    }
    if (metadata.hasVisited(resolvedPath)) {
        if (origin !== undefined) metadata.recordReference(origin.fromNode, resolvedPath);
        return false;
    }
    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        metadata.recordMissingImportJsonPath(resolvedPath);
        if (origin !== undefined) metadata.recordMissing(origin.fromNode, resolvedPath);
        const diag = origin === undefined
            ? Diagnostic.error(`import.json file does not exist '${resolvedPath}'`)
            : Diagnostic.error(`Included import.json not found: '${origin.includePath}'`)
                .addPrimarySpan(
                    origin.includeParser.span(),
                    `resolved to '${resolvedPath}'`
                )
                .addSubDiagnostic(Diagnostic.note(`included from '${origin.fromNode.path}'`));
        diag.addSubDiagnostic(
            Diagnostic.help("Check the include path and verify the target file exists")
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
