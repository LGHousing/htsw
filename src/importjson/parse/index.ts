import * as json from "jsonc-parser";

import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Ir, IrAction, IrImportable, Spanned } from "../../ir";
import { nodeSpan, parseArray, parseBoolean, parseBoundedNumber, parseIrBounds, parseIrPos, parseObject, parseOption, parseString, withNodeSpan } from "./helpers";
import { parseActions } from "./actions";
import { Span } from "../../span";
import { EVENTS, type Bounds, type Event, type NpcEquipment, type NpcSkin, type Pos } from "../../types";

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
        "npcs": {
            required: false,
            parser: (npcsNode) => parseAndAppendImportables(gcx, npcsNode, parseImportableNpc),
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
    parser: (gcx: GlobalCtxt, node: json.Node) => IrImportable
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

function parseImportableFunction(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let name: Spanned<string> | undefined;
    let actions: Spanned<IrAction[]> | undefined;
    let repeatTicks: Spanned<number> | undefined;

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (node) => {
                name = withNodeSpan(parseString(gcx, node), node);
            }
        },
        "actions": {
            required: true,
            parser: (node) => {
                actions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "repeatTicks": {
            required: false,
            parser: (node) => {
                repeatTicks = withNodeSpan(
                    parseBoundedNumber(4, 18000)(gcx, node),
                    node
                );
            }
        },
    });

    return {
        type: "FUNCTION",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        name, actions, repeatTicks
    };
}

function parseImportableEvent(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let event: Spanned<Event> | undefined;
    let actions: Spanned<IrAction[]> | undefined;
    
    parseObject(gcx, node, {
        "event": {
            required: true,
            parser: (node) => {
                event = withNodeSpan(
                    parseOption(gcx, node, EVENTS, { singular: "event", plural: "events" }),
                    node
                );
            }
        },
        "actions": {
            required: true,
            parser: (node) => {
                actions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
    });
    
    return {
        type: "EVENT",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        event, actions
    };
}

function parseImportableRegion(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let name: Spanned<string> | undefined;
    let bounds: Spanned<Ir<Bounds>> | undefined;
    let onEnterActions: Spanned<IrAction[]> | undefined;
    let onExitActions: Spanned<IrAction[]> | undefined;
        
    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (node) => {
                name = withNodeSpan(parseString(gcx, node), node);
            }
        },
        "bounds": {
            required: false,
            parser: (node) => {
                bounds = withNodeSpan(parseIrBounds(gcx, node), node);
            }
        },
        "onEnterActions": {
            required: false,
            parser: (node) => {
                onEnterActions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "onExitActions": {
            required: false,
            parser: (node) => {
                onExitActions = withNodeSpan(parseActions(gcx, node), node);
            }
        }
    });
    
    return {
        type: "REGION",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        name, bounds, onEnterActions, onExitActions
    };
}

function parseImportableNpc(gcx: GlobalCtxt, node: json.Node): IrImportable {
    let name: Spanned<string> | undefined;
    let pos: Spanned<Ir<Pos>> | undefined;
    let leftClickActions: Spanned<IrAction[]> | undefined;
    let rightClickActions: Spanned<IrAction[]> | undefined;
    let lookAtPlayers: Spanned<boolean> | undefined;
    let hideNameTag: Spanned<boolean> | undefined;
    let skin: Spanned<NpcSkin> | undefined;
    let equipment: Spanned<Ir<NpcEquipment>> | undefined;

    parseObject(gcx, node, {
        "name": {
            required: true,
            parser: (node) => {
                name = withNodeSpan(parseString(gcx, node), node);
            }
        },
        "pos": {
            required: true,
            parser: (node) => {
                pos = withNodeSpan(parseIrPos(gcx, node), node);
            }
        },
        "leftClickActions": {
            required: false,
            parser: (node) => {
                leftClickActions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "rightClickActions": {
            required: false,
            parser: (node) => {
                rightClickActions = withNodeSpan(parseActions(gcx, node), node);
            }
        },
        "lookAtPlayers": {
            required: false,
            parser: (node) => {
                lookAtPlayers = withNodeSpan(parseBoolean(gcx, node), node);
            }
        },
        "hideNameTag": {
            required: false,
            parser: (node) => {
                hideNameTag = withNodeSpan(parseBoolean(gcx, node), node);
            }
        },
        "skin": {
            required: false,
            parser: (node) => {
                skin = withNodeSpan(
                    parseOption(gcx, node, NPC_SKINS, { singular: "skin", plural: "skins" }),
                    node
                );
            }
        },
        "equipment": {
            required: false,
            parser: (node) => {
                equipment = withNodeSpan(parseIrNpcEquipment(gcx, node), node);
            }
        },
    });

    return {
        type: "NPC",
        typeSpan: Span.dummy(), span: nodeSpan(node),
        name, pos, leftClickActions, rightClickActions, lookAtPlayers, hideNameTag, skin, equipment,
    };
}

function parseIrNpcEquipment(gcx: GlobalCtxt, node: json.Node): Ir<NpcEquipment> {
    let helmet: Spanned<string> | undefined;
    let chestplate: Spanned<string> | undefined;
    let leggings: Spanned<string> | undefined;
    let boots: Spanned<string> | undefined;
    let hand: Spanned<string> | undefined;

    parseObject(gcx, node, {
        "helmet": {
            required: false,
            parser: (node) => {
                helmet = withNodeSpan(parseSnbtPath(gcx, node), node);
            }
        },
        "chestplate": {
            required: false,
            parser: (node) => {
                chestplate = withNodeSpan(parseSnbtPath(gcx, node), node);
            }
        },
        "leggings": {
            required: false,
            parser: (node) => {
                leggings = withNodeSpan(parseSnbtPath(gcx, node), node);
            }
        },
        "boots": {
            required: false,
            parser: (node) => {
                boots = withNodeSpan(parseSnbtPath(gcx, node), node);
            }
        },
        "hand": {
            required: false,
            parser: (node) => {
                hand = withNodeSpan(parseSnbtPath(gcx, node), node);
            }
        },
    });

    return { helmet, chestplate, leggings, boots, hand };
}

function parseSnbtPath(gcx: GlobalCtxt, node: json.Node): string {
    const filePath = parseString(gcx, node);

    if (!filePath.endsWith(".snbt")) {
        throw Diagnostic.error("Expected SNBT file")
            .addPrimarySpan(nodeSpan(node), "Invalid extension");
    }

    if (!gcx.fileExists(filePath)) {
        throw Diagnostic.error("SNBT file does not exist")
            .addPrimarySpan(nodeSpan(node), "Not found");
    }

    return filePath;
}
