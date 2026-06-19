import * as json from "jsonc-parser";

import type { GlobalCtxt, ImportJsonFileNode } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { parseActions, parseActionsWithPath } from "./actions";
import {
    nodeSpan,
    parseArray,
    parseBoolean,
    parseBoundedNumber,
    parseBounds,
    parseObjectWithSchema,
    parseOption,
    parsePos,
    parseString,
    setFieldSpan,
    setSpan,
} from "./helpers";
import { parseSnbt, type Tag } from "../../nbt";
import {
    EVENTS,
    MINECRAFT_ITEMS,
    type Event,
    type FunctionIcon,
    type Importable,
    type ImportableEvent,
    type ImportableFunction,
    type ImportableItem,
    type ImportableMenu,
    type ImportableNpc,
    type ImportableRegion,
    type MenuSlot,
    type NpcEquipment,
    type NpcSkin,
} from "../../types";
import { parseNbt } from "./nbt";
import { definition, IMPORT_JSON_SCHEMA, NPC_SKINS } from "../schemaSpec";

type IncludeOrigin = {
    includeNode: json.Node;
    includePath: string;
    fromNode: ImportJsonFileNode;
};

export function parseImportJson(gcx: GlobalCtxt, path: string, origin?: IncludeOrigin) {
    const resolvedPath = resolveImportJsonPath(gcx, path);

    if (!prepareImportJsonParsing(gcx, resolvedPath, origin)) return;

    // Attach before parsing, so a file that fails to parse still counts as
    // visited — a second include of it must not produce a second node (or a
    // second error).
    const fileNode: ImportJsonFileNode = {
        path: resolvedPath,
        importables: [],
        includes: [],
    };
    if (origin !== undefined) origin.fromNode.includes.push(fileNode);
    else gcx.fileTree = fileNode;

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

        parseImportJsonObject(gcx, tree, fileNode);
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

function parseImportJsonObject(gcx: GlobalCtxt, node: json.Node, fileNode: ImportJsonFileNode) {
    const seenIncludes = new Set<string>();

    parseObjectWithSchema(gcx, node, IMPORT_JSON_SCHEMA, {
        "houseUuid": (uuidNode) => parseHouseUuid(gcx, uuidNode, fileNode.path),
        "include": (includeNode) => parseIncludes(gcx, includeNode, fileNode, seenIncludes),
        "functions": (functionsNode) => parseAndAppendImportables(gcx, functionsNode, fileNode, parseImportableFunction),
        "events": (eventsNode) => parseAndAppendImportables(gcx, eventsNode, fileNode, parseImportableEvent),
        "regions": (regionsNode) => parseAndAppendImportables(gcx, regionsNode, fileNode, parseImportableRegion),
        "items": (itemsNode) => parseAndAppendImportables(gcx, itemsNode, fileNode, parseImportableItem),
        "npcs": (npcsNode) => parseAndAppendImportables(gcx, npcsNode, fileNode, parseImportableNpc),
        "menus": (menusNode) => parseAndAppendImportables(gcx, menusNode, fileNode, parseImportableMenu),
    });
}

const HOUSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseHouseUuid(gcx: GlobalCtxt, node: json.Node, currentPath: string) {
    const value = parseString(gcx, node);

    if (!HOUSE_UUID_RE.test(value)) {
        gcx.addDiagnostic(
            Diagnostic.error("Expected a housing UUID")
                .addPrimarySpan(nodeSpan(node), value)
                .addSubDiagnostic(
                    Diagnostic.help("Housing UUIDs look like '01234567-89ab-cdef-0123-456789abcdef'")
                )
        );
        return;
    }

    // Entry file only: gcx.activeImportJsonPaths still holds the entry file
    // while its includes parse, so depth > 1 means this file was included.
    if (gcx.activeImportJsonPaths.length > 1) {
        gcx.addDiagnostic(
            Diagnostic.warning("'houseUuid' in an included import.json is ignored")
                .addPrimarySpan(nodeSpan(node))
                .addSubDiagnostic(
                    Diagnostic.note(`only the entry import.json binds the parse to a house; this key applies when '${currentPath}' is parsed directly`)
                )
        );
        return;
    }

    gcx.houseUuid = value.toLowerCase();
}

function parseIncludes(
    gcx: GlobalCtxt,
    node: json.Node,
    fileNode: ImportJsonFileNode,
    seenIncludes: Set<string>
) {
    const currentPath = fileNode.path;
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
                fromNode: fileNode,
            }
        );
    });
}

function parseAndAppendImportables(
    gcx: GlobalCtxt,
    node: json.Node,
    fileNode: ImportJsonFileNode,
    parser: (gcx: GlobalCtxt, node: json.Node, declaringPath: string) => Importable
) {
    const parsed = parseArray(gcx, node, (elementNode) => parser(gcx, elementNode, fileNode.path));
    fileNode.importables.push(...parsed);
    gcx.importables.push(...parsed);
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
            diag.addSubDiagnostic(Diagnostic.note(`included from '${origin.fromNode.path}'`));
        }
        gcx.addDiagnostic(diag);
        return false;
    }

    // Already visited via another include chain — parse it only once. Must
    // run AFTER the cycle check: files still being parsed are in the tree
    // too, and a cycle should error, not be skipped silently.
    if (treeContainsPath(gcx.fileTree, resolvedPath)) return false;

    if (!gcx.sourceMap.fileLoader.fileExists(resolvedPath)) {
        gcx.missingImportJsonPaths.push(resolvedPath);
        const diag = origin
            ? Diagnostic.error(`Included import.json not found: '${origin.includePath}'`)
                .addPrimarySpan(
                    nodeSpan(origin.includeNode),
                    `resolved to '${resolvedPath}'`
                )
                .addSubDiagnostic(Diagnostic.note(`included from '${origin.fromNode.path}'`))
            : Diagnostic.error(`import.json file does not exist '${resolvedPath}'`);
        diag.addSubDiagnostic(
            Diagnostic.help("Check the include path and verify the target file exists")
        );
        gcx.addDiagnostic(diag);
        return false;
    }

    return true;
}

function treeContainsPath(node: ImportJsonFileNode | null, path: string): boolean {
    if (node === null) return false;
    if (node.path === path) return true;
    for (const child of node.includes) {
        if (treeContainsPath(child, path)) return true;
    }
    return false;
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

function parseImportableFunction(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableFunction {
    const importable = { type: "FUNCTION" } as ImportableFunction;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    // Default to the declaring import.json; overridden to the .htsl on
    // successful parseActionsWithPath below.
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("functionImportable"), {
        "name": (child) => {
            importable.name = parseString(gcx, child);
            setFieldSpan(gcx, importable, "name", child);
        },
        "actions": (child) => {
            const parsed = parseActionsWithPath(gcx, child);
            importable.actions = parsed.actions;
            gcx.sourceFiles.set(importable, parsed.resolvedPath);
            setFieldSpan(gcx, importable, "actions", child);
        },
        "repeatTicks": (child) => {
            importable.repeatTicks = parseBoundedNumber(4, 18000)(gcx, child);
            setFieldSpan(gcx, importable, "repeatTicks", child);
        },
        "icon": (child) => {
            importable.icon = parseFunctionIcon(gcx, child);
            setFieldSpan(gcx, importable, "icon", child);
        },
    });

    return importable;
}

function parseFunctionIcon(gcx: GlobalCtxt, node: json.Node): FunctionIcon {
    const icon = {} as FunctionIcon;
    setSpan(gcx, icon, node);

    parseObjectWithSchema(gcx, node, definition("functionIcon"), {
        "item": (child) => {
            icon.item = parseMinecraftItemId(gcx, child);
            setFieldSpan(gcx, icon, "item", child);
        },
        "count": (child) => {
            const count = parseBoundedNumber(1, 64)(gcx, child);
            if (!Number.isInteger(count)) {
                gcx.addDiagnostic(
                    Diagnostic.error("Item count must be an integer")
                        .addPrimarySpan(nodeSpan(child))
                );
            }
            icon.count = count;
            setFieldSpan(gcx, icon, "count", child);
        },
        "enchanted": (child) => {
            icon.enchanted = parseBoolean(gcx, child);
            setFieldSpan(gcx, icon, "enchanted", child);
        },
    });

    return icon;
}

function parseMinecraftItemId(gcx: GlobalCtxt, node: json.Node): string {
    const raw = parseString(gcx, node);
    const normalized = raw.toLowerCase();
    const itemName = normalized.startsWith("minecraft:")
        ? normalized.slice("minecraft:".length)
        : normalized;

    const match = MINECRAFT_ITEMS.find((item) => item.name === itemName);
    if (match === undefined) {
        gcx.addDiagnostic(
            Diagnostic.error(`Invalid item id '${raw}'`)
                .addPrimarySpan(nodeSpan(node))
        );
        return normalized;
    }

    return `minecraft:${match.name}`;
}

function parseImportableEvent(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableEvent {
    const importable = { type: "EVENT" } as ImportableEvent;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("eventImportable"), {
        "event": (child) => {
            importable.event = parseOption(
                gcx, child, EVENTS, { singular: "event", plural: "events" }
            ) as Event;
            setFieldSpan(gcx, importable, "event", child);
        },
        "actions": (child) => {
            const parsed = parseActionsWithPath(gcx, child);
            importable.actions = parsed.actions;
            gcx.sourceFiles.set(importable, parsed.resolvedPath);
            setFieldSpan(gcx, importable, "actions", child);
        },
    });

    return importable;
}

function parseImportableRegion(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableRegion {
    const importable = { type: "REGION" } as ImportableRegion;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("regionImportable"), {
        "name": (child) => {
            importable.name = parseString(gcx, child);
            setFieldSpan(gcx, importable, "name", child);
        },
        "bounds": (child) => {
            importable.bounds = parseBounds(gcx, child);
            setFieldSpan(gcx, importable, "bounds", child);
        },
        "onEnterActions": (child) => {
            importable.onEnterActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "onEnterActions", child);
        },
        "onExitActions": (child) => {
            importable.onExitActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "onExitActions", child);
        }
    });

    return importable;
}

function parseImportableNpc(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableNpc {
    const importable = { type: "NPC" } as ImportableNpc;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("npcImportable"), {
        "name": (child) => {
            importable.name = parseString(gcx, child);
            setFieldSpan(gcx, importable, "name", child);
        },
        "pos": (child) => {
            importable.pos = parsePos(gcx, child);
            setFieldSpan(gcx, importable, "pos", child);
        },
        "leftClickActions": (child) => {
            importable.leftClickActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "leftClickActions", child);
        },
        "rightClickActions": (child) => {
            importable.rightClickActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "rightClickActions", child);
        },
        "lookAtPlayers": (child) => {
            importable.lookAtPlayers = parseBoolean(gcx, child);
            setFieldSpan(gcx, importable, "lookAtPlayers", child);
        },
        "hideNameTag": (child) => {
            importable.hideNameTag = parseBoolean(gcx, child);
            setFieldSpan(gcx, importable, "hideNameTag", child);
        },
        "skin": (child) => {
            importable.skin = parseOption(
                gcx, child, NPC_SKINS, { singular: "skin", plural: "skins" }
            ) as NpcSkin;
            setFieldSpan(gcx, importable, "skin", child);
        },
        "equipment": (child) => {
            importable.equipment = parseNpcEquipment(gcx, child);
            setFieldSpan(gcx, importable, "equipment", child);
        },
    });

    return importable;
}

function parseNpcEquipment(gcx: GlobalCtxt, node: json.Node): NpcEquipment {
    const equipment: NpcEquipment = {};
    setSpan(gcx, equipment as object, node);

    parseObjectWithSchema(gcx, node, definition("npcEquipment"), {
        "helmet": (child) => {
            equipment.helmet = parseString(gcx, child);
            setFieldSpan(gcx, equipment, "helmet", child);
        },
        "chestplate": (child) => {
            equipment.chestplate = parseString(gcx, child);
            setFieldSpan(gcx, equipment, "chestplate", child);
        },
        "leggings": (child) => {
            equipment.leggings = parseString(gcx, child);
            setFieldSpan(gcx, equipment, "leggings", child);
        },
        "boots": (child) => {
            equipment.boots = parseString(gcx, child);
            setFieldSpan(gcx, equipment, "boots", child);
        },
        "hand": (child) => {
            equipment.hand = parseString(gcx, child);
            setFieldSpan(gcx, equipment, "hand", child);
        },
    });

    return equipment;
}

function parseImportableItem(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableItem {
    const importable = { type: "ITEM" } as ImportableItem;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("itemImportable"), {
        "name": (child) => {
            importable.name = parseString(gcx, child);
            setFieldSpan(gcx, importable, "name", child);
        },
        "nbt": (child) => {
            importable.nbt = parseNbt(gcx, child);
            setFieldSpan(gcx, importable, "nbt", child);
        },
        "leftClickActions": (child) => {
            importable.leftClickActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "leftClickActions", child);
        },
        "rightClickActions": (child) => {
            importable.rightClickActions = parseActions(gcx, child);
            setFieldSpan(gcx, importable, "rightClickActions", child);
        },
    });

    return importable;
}

function parseImportableMenu(gcx: GlobalCtxt, node: json.Node, declaringPath: string): ImportableMenu {
    const importable = { type: "MENU", slots: [] as MenuSlot[] } as ImportableMenu;
    setSpan(gcx, importable, node);
    setFieldSpan(gcx, importable, "type", node);
    gcx.sourceFiles.set(importable, declaringPath);

    parseObjectWithSchema(gcx, node, definition("menuImportable"), {
        "name": (child) => {
            importable.name = parseString(gcx, child);
            setFieldSpan(gcx, importable, "name", child);
        },
        "size": (child) => {
            const size = parseBoundedNumber(1, 6)(gcx, child);
            if (!Number.isInteger(size)) {
                gcx.addDiagnostic(
                    Diagnostic.error("Menu size (in lines) must be an integer")
                        .addPrimarySpan(nodeSpan(child))
                );
            }
            importable.size = size;
            setFieldSpan(gcx, importable, "size", child);
        },
        "slots": (child) => {
            importable.slots = parseArray(gcx, child, (slotNode) =>
                parseMenuSlot(gcx, slotNode)
            );
            setFieldSpan(gcx, importable, "slots", child);
        },
    });

    return importable;
}

function parseMenuSlot(gcx: GlobalCtxt, node: json.Node): MenuSlot {
    const slot = {} as MenuSlot;
    setSpan(gcx, slot as object, node);

    parseObjectWithSchema(gcx, node, definition("menuSlot"), {
        "slot": (child) => {
            const slotIndex = parseBoundedNumber(0, 53)(gcx, child);
            if (!Number.isInteger(slotIndex)) {
                gcx.addDiagnostic(
                    Diagnostic.error("Menu slot index must be an integer")
                        .addPrimarySpan(nodeSpan(child))
                );
            }
            slot.slot = slotIndex;
            setFieldSpan(gcx, slot, "slot", child);
        },
        "nbt": (child) => {
            slot.nbt = parseNbt(gcx, child);
            setFieldSpan(gcx, slot, "nbt", child);
        },
        "actions": (child) => {
            slot.actions = parseActions(gcx, child);
            setFieldSpan(gcx, slot, "actions", child);
        },
    });

    return slot;
}
