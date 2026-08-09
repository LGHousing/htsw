import type {
    ImportableCommand,
    ImportableEvent,
    ImportableFunction,
    ImportableGroup,
    ImportableItem,
    ImportableMenu,
    ImportableNpc,
    ImportableRegion,
    ImportableTeam,
    NpcEquipment,
    NpcSkin,
} from "../../types";
import {
    parseHtsl,
    parseBounds,
    parseColor,
    parseEvent,
    parseFunctionIcon,
    parseMenuSlots,
    parsePermissions,
    parseChatSpeed,
    parseDefaultGameMode,
    parseSnbt,
    parseCommandMode,
    parsePos,
    parseTag,
} from "./arguments";
import { contentFilePath, parseOption, warnUnused } from "./helpers";
import type { Parser } from "./parser";
import type {
    RawCommandImportable,
    RawEventImportable,
    RawFunctionImportable,
    RawGroupImportable,
    RawItemImportable,
    RawMenuImportable,
    RawNpcEquipment,
    RawNpcImportable,
    RawRegionImportable,
    RawTeamImportable,
} from "../schemaSpec";
import {
    optionalRawField,
    parseRawFields,
    requiredRawField,
} from "./rawFields";

export function parseImportableFunction(p: Parser): ImportableFunction {
    const im: ImportableFunction = { type: "FUNCTION" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawFunctionImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        actions: optionalRawField((field) => {
            field.setField(im, "actions", parseHtsl);
            im.sourcePath = contentFilePath(field);
        }),
        repeatTicks: optionalRawField((field) =>
            field.setField(im, "repeatTicks", (p) =>
                p.parseBoundedNumber(4, 18000)
            )
        ),
        icon: optionalRawField((field) =>
            field.setField(im, "icon", parseFunctionIcon)
        ),
    });

    warnUnused(p);
    return im;
}

export function parseImportableRegion(p: Parser): ImportableRegion {
    const im: ImportableRegion = { type: "REGION" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawRegionImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        bounds: requiredRawField((field) =>
            field.setField(im, "bounds", parseBounds)
        ),
        onEnterActions: optionalRawField((field) => {
            field.setField(im, "onEnterActions", parseHtsl);
            im.onEnterActionsPath = contentFilePath(field);
        }),
        onExitActions: optionalRawField((field) => {
            field.setField(im, "onExitActions", parseHtsl);
            im.onExitActionsPath = contentFilePath(field);
        }),
    });

    warnUnused(p);
    return im;
}

export function parseImportableMenu(p: Parser): ImportableMenu {
    const im: ImportableMenu = { type: "MENU" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawMenuImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        size: optionalRawField((field) =>
            field.setField(im, "size", (p) => p.parseBoundedNumber(1, 6))
        ),
        slots: requiredRawField((field) =>
            field.setField(im, "slots", parseMenuSlots)
        ),
    });

    warnUnused(p);
    return im;
}

export function parseImportableItem(p: Parser): ImportableItem {
    const im: ImportableItem = { type: "ITEM" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawItemImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        nbt: requiredRawField((field) => {
            field.setField(im, "nbt", parseSnbt);
            im.sourcePath = contentFilePath(field);
        }),
        leftClickActions: optionalRawField((field) => {
            field.setField(im, "leftClickActions", parseHtsl);
            im.leftClickActionsPath = contentFilePath(field);
        }),
        rightClickActions: optionalRawField((field) => {
            field.setField(im, "rightClickActions", parseHtsl);
            im.rightClickActionsPath = contentFilePath(field);
        }),
    });

    warnUnused(p);
    return im;
}

export function parseImportableEvent(p: Parser): ImportableEvent {
    const im: ImportableEvent = { type: "EVENT" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawEventImportable>(p, {
        event: requiredRawField((field) =>
            field.setField(im, "event", parseEvent)
        ),
        actions: requiredRawField((field) => {
            field.setField(im, "actions", parseHtsl);
            im.sourcePath = contentFilePath(field);
        }),
    });

    warnUnused(p);
    return im;
}

export function parseImportableTeam(p: Parser): ImportableTeam {
    const im: ImportableTeam = { type: "TEAM" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawTeamImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        tag: optionalRawField((field) => field.setField(im, "tag", parseTag)),
        color: optionalRawField((field) =>
            field.setField(im, "color", parseColor)
        ),
        friendlyFire: optionalRawField((field) =>
            field.setField(im, "friendlyFire", (p) => p.parseBoolean())
        ),
    });

    warnUnused(p);
    return im;
}

export function parseImportableGroup(p: Parser): ImportableGroup {
    const im: ImportableGroup = { type: "GROUP" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawGroupImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        tag: optionalRawField((field) => field.setField(im, "tag", parseTag)),
        tagShownInChat: optionalRawField((field) =>
            field.setField(im, "tagShownInChat", (p) => p.parseBoolean())
        ),
        color: optionalRawField((field) =>
            field.setField(im, "color", parseColor)
        ),
        priority: optionalRawField((field) =>
            field.setField(im, "priority", (p) => p.parseBoundedNumber(0, 20))
        ),
        permissions: optionalRawField((field) =>
            field.setField(im, "permissions", parsePermissions)
        ),
        chatSpeed: optionalRawField((field) =>
            field.setField(im, "chatSpeed", parseChatSpeed)
        ),
        defaultGameMode: optionalRawField((field) =>
            field.setField(im, "defaultGameMode", parseDefaultGameMode)
        ),
    });

    warnUnused(p);
    return im;
}

export function parseImportableCommand(p: Parser): ImportableCommand {
    const im: ImportableCommand = { type: "COMMAND" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawCommandImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        actions: optionalRawField((field) => {
            field.setField(im, "actions", parseHtsl);
            im.sourcePath = contentFilePath(field);
        im.actionsPath = im.sourcePath;
        }),
        mode: optionalRawField((field) =>
            field.setField(im, "mode", parseCommandMode)
        ),
        requiredPriority: optionalRawField((field) =>
            field.setField(im, "requiredPriority", (p) =>
                p.parseBoundedNumber(0, 20)
            )
        ),
        listed: optionalRawField((field) =>
            field.setField(im, "listed", (p) => p.parseBoolean())
        ),
    });

    warnUnused(p);
    return im;
}

export function parseImportableNpc(p: Parser): ImportableNpc {
    const im: ImportableNpc = { type: "NPC" } as any;
    p.setNodeSpan(im);

    parseRawFields<RawNpcImportable>(p, {
        name: requiredRawField((field) =>
            field.setField(im, "name", (p) => p.parseString())
        ),
        pos: requiredRawField((field) => field.setField(im, "pos", parsePos)),
        leftClickActions: optionalRawField((field) => {
            field.setField(im, "leftClickActions", parseHtsl);
            im.leftClickActionsPath = contentFilePath(field);
        }),
        rightClickActions: optionalRawField((field) => {
            field.setField(im, "rightClickActions", parseHtsl);
            im.rightClickActionsPath = contentFilePath(field);
        }),
        leftClickRedirect: optionalRawField((field) =>
            field.setField(im, "leftClickRedirect", (p) => p.parseBoolean())
        ),
        lookAtPlayers: optionalRawField((field) =>
            field.setField(im, "lookAtPlayers", (p) => p.parseBoolean())
        ),
        hideNameTag: optionalRawField((field) =>
            field.setField(im, "hideNameTag", (p) => p.parseBoolean())
        ),
        skin: optionalRawField((field) =>
            field.setField(im, "skin", parseNpcSkin)
        ),
        equipment: optionalRawField((field) =>
            field.setField(im, "equipment", parseNpcEquipment)
        ),
    });

    warnUnused(p);
    return im;
}

function parseNpcSkin(p: Parser): NpcSkin {
    return parseOption(p, ["Steve", "Alex", "Players Skin"], {
        singular: "skin",
        plural: "skins",
    });
}

function parseNpcEquipment(p: Parser): NpcEquipment {
    const equipment: NpcEquipment = {};
    parseRawFields<RawNpcEquipment>(p, {
        helmet: optionalRawField((field) =>
            field.setField(equipment, "helmet", (p) => p.parseString())
        ),
        chestplate: optionalRawField((field) =>
            field.setField(equipment, "chestplate", (p) => p.parseString())
        ),
        leggings: optionalRawField((field) =>
            field.setField(equipment, "leggings", (p) => p.parseString())
        ),
        boots: optionalRawField((field) =>
            field.setField(equipment, "boots", (p) => p.parseString())
        ),
        hand: optionalRawField((field) =>
            field.setField(equipment, "hand", (p) => p.parseString())
        ),
    });
    warnUnused(p);
    return equipment;
}
