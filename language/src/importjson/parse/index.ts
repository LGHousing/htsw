import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { parseActions } from "./actions";
import {
    nodeSpan,
    parseArray,
    parseBoolean,
    parseBoundedNumber,
    parseBounds,
    parseObject,
    parseOption,
    parsePos,
    parseString,
    setFieldSpan,
    setSpan,
} from "./helpers";
import { parseSnbt, type Tag } from "../../nbt";
import {
    EVENTS,
    type Event,
    type Importable,
    type ImportableEvent,
    type ImportableFunction,
    type ImportableItem,
    type ImportableNpc,
    type ImportableRegion,
    type NpcEquipment,
    type NpcSkin,
} from "../../types";
import { parseNbt } from "./nbt";

type IncludeOrigin = {
    includeNode: json.Node;
    includePath: string;
    fromPath: string;
};

const NPC_SKINS = ["Steve", "Alex", "Players Skin"] as const;

export function parseImportJson(gcx: GlobalCtxt, path: string, origin?: IncludeOrigin) {
    const resolvedPath = resolveImportJsonPath(gcx, path);

    if (!prepareImportJsonParsing(gcx, resolvedPath, origin)) return;

    gcx.activeImportJsonPaths.push(resolvedPath);

    try {
        const file = gcx.sourceMap.getFile(resolvedPath);
        const tree = json.parseTree(file.src);

        if (!tree) {
            gcx.addDiagnostic(
                Diagnostic.error(`Couldn't parse file '${resolvedPath}'`)
            );
            return;
        }

        parseImportJsonObject(gcx, tree, resolvedPath);
        gcx.loadedImportJsonPaths.add(resolvedPath);
    } catch (e) {
        if (e instanceof Diagnostic) {
            gcx.addDiagnostic(e);
        } else if (e instanceof Error) {
            gcx.addDiagnostic(Diagnostic.bugFromError(e));
        } else {
            gcx.addDiagnostic(Diagnostic.bug(`An unknown error occurred parsing ${resolvedPath}`));
        }
    } finally {
        if (gcx.activeImportJsonPaths[gcx.activeImportJsonPaths.length - 1] === resolvedPath) {
            gcx.activeImportJsonPaths.pop();
        } else {
            const index = gcx.activeImportJsonPaths.indexOf(resolvedPath);
            if (index !== -1) gcx.activeImportJsonPaths.splice(index, 1);
        }
    }
}

function parseImportJsonObject(gcx: GlobalCtxt, node: json.Node, currentPath: string) {
    const seenIncludes = new Set<string>();

    parseObject(gcx, node, {
        "include": {
            required: false,
            parser: (includeNode) => parseIncludes(gcx, includeNode, currentPath, seenIncludes),
        },
        "functions": {
            required: false,
            parser: (functionsNode) => parseAndAppendImportables(gcx, functionsNode, parseImportableFunction),
        },
        "events": {
            required: false,
            parser: (eventsNode) => parseAndAppendImportables(gcx, eventsNode, parseImportableEvent),
        },
        "regions": {
            required: false,
            parser: (regionsNode) => parseAndAppendImportables(gcx, regionsNode, parseImportableRegion),
        },
        "items": {
            required: false,
            parser: (itemsNode) => parseAndAppendImportables(gcx, itemsNode, parseImportableItem),
        }
    });
}

function parseIncludes(
    gcx: GlobalCtxt,
    node: json.Node,
    currentPath: string,
    seenIncludes: Set<string>
) {
    parseArray(gcx, node, (child) => {
        const includePath = parseString(gcx, child);

        if (!isImportJsonPath(includePath)) {
            const diag = Diagnostic.error("Expected include path to an import.json file")
                .addPrimarySpan(nodeSpan(child), includePath);
            diag.addSubDiagnostic(
                Diagnostic.help("Include paths must end with 'import.json' or '.import.json'")
            );
            gcx.addDiagnostic(diag);
            return;
        }

        const resolvedIncludePath = resolveRelativeImportJsonPath(gcx, currentPath, includePath);
        if (seenIncludes.has(resolvedIncludePath)) {
            gcx.addDiagnostic(
                Diagnostic.warning(`Duplicate include path '${includePath}'`)
                    .addPrimarySpan(nodeSpan(child), `resolves to '${resolvedIncludePath}'`)
            );
            return;
        }

        seenIncludes.add(resolvedIncludePath);
        parseImportJson(
            gcx.subContext(resolvedIncludePath),
            resolvedIncludePath,
            {
                includeNode: child,
                includePath,
                fromPath: currentPath,
            }
        );
    });
}

function parseAndAppendImportables(
    gcx: GlobalCtxt,
    node: json.Node,
    parser: (gcx: GlobalCtxt, node: json.Node) => Importable
) {
    gcx.importables.push(
        ...parseArray(gcx, node, (elementNode) => parser(gcx, elementNode))
    );
}

function prepareImportJsonParsing(
    gcx: GlobalCtxt,
    resolvedPath: string,
    origin?: IncludeOrigin
): boolean {
    if (gcx.activeImportJsonPaths.includes(resolvedPath)) {
        const cyclePath = [...gcx.activeImportJsonPaths, resolvedPath].join(" -> ");
        const diag = Diagnostic.error("Circular import.json include")
            .addSubDiagnostic(Diagnostic.note(cyclePath));
        if (origin) {
            diag.addPrimarySpan(
                nodeSpan(origin.includeNode),
                `include '${origin.includePath}' resolves to '${resolvedPath}'`
            );
            diag.addSubDiagnostic(Diagnostic.note(`included from '${origin.fromPath}'`));
        }
        gcx.addDiagnostic(diag);
        return false;
    }

    if (gcx.loadedImportJsonPaths.has(resolvedPath)) return false;

    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        const diag = origin
            ? Diagnostic.error(`Included import.json not found: '${origin.includePath}'`)
                .addPrimarySpan(
                    nodeSpan(origin.includeNode),
                    `resolved to '${resolvedPath}'`
                )
                .addSubDiagnostic(Diagnostic.note(`included from '${origin.fromPath}'`))
            : Diagnostic.error(`import.json file does not exist '${resolvedPath}'`);
        diag.addSubDiagnostic(
            Diagnostic.help("Check the include path and verify the target file exists")
        );
        gcx.addDiagnostic(diag);
        return false;
    }

    return true;
}

function isImportJsonPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith("import.json") || normalizedPath.endsWith(".import.json");
}

function resolveRelativeImportJsonPath(
    gcx: GlobalCtxt,
    currentPath: string,
    includePath: string
): string {
    const parentPath = gcx.sourceMap.fileLoader.getParentPath(currentPath);
    return gcx.sourceMap.fileLoader.resolvePath(parentPath, includePath);
}

function resolveImportJsonPath(gcx: GlobalCtxt, path: string): string {
    if (gcx.sourceMap.fileLoader.fileExists(path)) {
        return path;
    }

    return gcx.resolvePath(path);
}

function parseImportableFunction(gcx: GlobalCtxt, node: json.Node): ImportableFunction {
    const importable = { type: "FUNCTION" } as ImportableFunction;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (child) => {
                importable.name = parseString(gcx, child);
                setFieldSpan(gcx, importable, "name", child);
            }
        },
        "actions": {
            required: true,
            parser: (child) => {
                importable.actions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "actions", child);
            }
        },
        "repeatTicks": {
            required: false,
            parser: (child) => {
                importable.repeatTicks = parseBoundedNumber(4, 18000)(gcx, child);
                setFieldSpan(gcx, importable, "repeatTicks", child);
            }
        },
    });

    return importable;
}

function parseImportableEvent(gcx: GlobalCtxt, node: json.Node): ImportableEvent {
    const importable = { type: "EVENT" } as ImportableEvent;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);

    parseObject(gcx, node, {
        "event": {
            required: true,
            parser: (child) => {
                importable.event = parseOption(
                    gcx, child, EVENTS, { singular: "event", plural: "events" }
                ) as Event;
                setFieldSpan(gcx, importable, "event", child);
            }
        },
        "actions": {
            required: true,
            parser: (child) => {
                importable.actions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "actions", child);
            }
        },
    });

    return importable;
}

function parseImportableRegion(gcx: GlobalCtxt, node: json.Node): ImportableRegion {
    const importable = { type: "REGION" } as ImportableRegion;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (child) => {
                importable.name = parseString(gcx, child);
                setFieldSpan(gcx, importable, "name", child);
            }
        },
        "bounds": {
            required: false,
            parser: (child) => {
                importable.bounds = parseBounds(gcx, child);
                setFieldSpan(gcx, importable, "bounds", child);
            }
        },
        "onEnterActions": {
            required: false,
            parser: (child) => {
                importable.onEnterActions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "onEnterActions", child);
            }
        },
        "onExitActions": {
            required: false,
            parser: (child) => {
                importable.onExitActions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "onExitActions", child);
            }
        }
    });

    return importable;
}

function parseImportableItem(gcx: GlobalCtxt, node: json.Node): ImportableItem {
    const importable = { type: "ITEM" } as ImportableItem;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (child) => {
                importable.name = parseString(gcx, child);
                setFieldSpan(gcx, importable, "name", child);
            }
        },
        "nbt": {
            required: true,
            parser: (child) => {
                importable.nbt = parseNbt(gcx, child);
                setFieldSpan(gcx, importable, "nbt", child);
            }
        },
        "leftClickActions": {
            required: false,
            parser: (child) => {
                importable.leftClickActions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "leftClickActions", child);
            }
        },
        "rightClickActions": {
            required: false,
            parser: (child) => {
                importable.rightClickActions = parseActions(gcx, child);
                setFieldSpan(gcx, importable, "rightClickActions", child);
            }
        },
    });

    return importable;
}