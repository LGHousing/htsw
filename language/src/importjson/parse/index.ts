import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import type { Importable } from "../../types";
import { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import { parseImportableEvent, parseImportableFunction, parseImportableGroup, parseImportableItem, parseImportableMenu, parseImportableRegion, parseImportableTeam } from "./importables";
import { getFileName, warnUnused } from "./helpers";
import { nullableFn } from "../../helpers";
import { parseUuid } from "./arguments";

export function parseImportJson(gcx: GlobalCtxt, path: string): Importable[] {
    try {
        const file = gcx.sourceMap.getFile(path);
        const tree = json.parseTree(file.src);

        if (tree === undefined) {
            gcx.addDiagnostic(Diagnostic.error("???"));
            return [];
        }

        const parser = new Parser(gcx, file.startPos, tree);
        return parseImportJson0(parser);
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

function parseImportJson0(p: Parser): Importable[] {
    const importables: Importable[] = []

    for (const sp of p.parseFieldOrUndefined("include")?.parseArray() ?? []) {
        parseInclude(sp);
    }

    p.gcx.houseUuid = nullableFn(parseUuid)(p.parseFieldOrUndefined("houseUuid"));

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

    for (const sp of p.parseFieldOrUndefined("events")?.parseArray() ?? []) {
        importables.push(parseImportableEvent(sp));
    }

    for (const sp of p.parseFieldOrUndefined("groups")?.parseArray() ?? []) {
        importables.push(parseImportableGroup(sp));
    }

    for (const sp of p.parseFieldOrUndefined("teams")?.parseArray() ?? []) {
        importables.push(parseImportableTeam(sp));
    }

    warnUnused(p, [
        "include", "houseUuid", "houseName", "functions",
        "regions", "menus", "items", "events", "groups",
        "teams"
    ]);
    return importables;
}

function parseInclude(p: Parser): Importable[] {
    const path = p.parseString();
    const fileName = getFileName(path);

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

    if (!p.gcx.fileExists(path)) {
        p.gcx.addDiagnostic(
            Diagnostic.error(`Couldn't read \`${fileName}\` file`)
                .addPrimarySpan(p.span(), "No such file")
        );
        return [];
    }

    if (p.gcx.sourceMap.hasFile(path)) {
        return []; // We have already parsed this file
    }

    return parseImportJson(p.gcx, path);
}
