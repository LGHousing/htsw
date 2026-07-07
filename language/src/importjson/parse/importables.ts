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
    parseSnbt,
    parseCommandMode,
    parsePos,
} from "./arguments";
import { contentFilePath, parseOption, warnUnused } from "./helpers";
import type { Parser } from "./parser";

export function parseImportableFunction(p: Parser): ImportableFunction {
    const im: ImportableFunction = { type: "FUNCTION" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    const actionsField = p.parseFieldOrUndefined("actions");
    actionsField?.setField(im, "actions", parseHtsl);
    if (actionsField) im.sourcePath = contentFilePath(actionsField);
    p.parseFieldOrUndefined("repeatTicks")?.setField(im, "repeatTicks", (p) =>
        p.parseBoundedNumber(4, 18000)
    );
    p.parseFieldOrUndefined("icon")?.setField(im, "icon", parseFunctionIcon);

    warnUnused(p, ["name", "actions", "repeatTicks", "icon"]);
    return im;
}

export function parseImportableRegion(p: Parser): ImportableRegion {
    const im: ImportableRegion = { type: "REGION" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseFieldOrUndefined("bounds")?.setField(im, "bounds", parseBounds);
    const onEnterField = p.parseFieldOrUndefined("onEnterActions");
    onEnterField?.setField(im, "onEnterActions", parseHtsl);
    if (onEnterField) im.onEnterActionsPath = contentFilePath(onEnterField);
    const onExitField = p.parseFieldOrUndefined("onExitActions");
    onExitField?.setField(im, "onExitActions", parseHtsl);
    if (onExitField) im.onExitActionsPath = contentFilePath(onExitField);

    warnUnused(p, ["name", "bounds", "onEnterActions", "onExitActions"]);
    return im;
}

export function parseImportableMenu(p: Parser): ImportableMenu {
    const im: ImportableMenu = { type: "MENU" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseFieldOrUndefined("size")?.setField(im, "size", (p) =>
        p.parseBoundedNumber(1, 54)
    );
    p.parseField("slots").setField(im, "slots", parseMenuSlots);

    warnUnused(p, ["name", "size", "slots"]);
    return im;
}

export function parseImportableItem(p: Parser): ImportableItem {
    const im: ImportableItem = { type: "ITEM" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    const nbtField = p.parseField("nbt");
    nbtField.setField(im, "nbt", parseSnbt);
    im.sourcePath = contentFilePath(nbtField);
    const leftField = p.parseFieldOrUndefined("leftClickActions");
    leftField?.setField(im, "leftClickActions", parseHtsl);
    if (leftField) im.leftClickActionsPath = contentFilePath(leftField);
    const rightField = p.parseFieldOrUndefined("rightClickActions");
    rightField?.setField(im, "rightClickActions", parseHtsl);
    if (rightField) im.rightClickActionsPath = contentFilePath(rightField);

    warnUnused(p, ["name", "nbt", "leftClickActions", "rightClickActions"]);
    return im;
}

export function parseImportableEvent(p: Parser): ImportableEvent {
    const im: ImportableEvent = { type: "EVENT" } as any;
    p.setNodeSpan(im);

    p.parseField("event").setField(im, "event", parseEvent);
    const actionsField = p.parseField("actions");
    actionsField.setField(im, "actions", parseHtsl);
    im.sourcePath = contentFilePath(actionsField);

    warnUnused(p, ["event", "actions"]);
    return im;
}

export function parseImportableTeam(p: Parser): ImportableTeam {
    const im: ImportableTeam = { type: "TEAM" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseFieldOrUndefined("tag")?.setField(im, "tag", (p) => p.parseString());
    p.parseFieldOrUndefined("color")?.setField(im, "color", parseColor);
    p.parseFieldOrUndefined("friendlyFire")?.setField(im, "friendlyFire", p => p.parseBoolean());

    warnUnused(p, ["name", "tag", "color", "friendlyFire"]);
    return im;
}

export function parseImportableGroup(p: Parser): ImportableGroup {
    const im: ImportableGroup = { type: "GROUP" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseFieldOrUndefined("tag")?.setField(im, "tag", (p) => p.parseString());
    p.parseFieldOrUndefined("tagShownInChat")?.setField(im, "tagShownInChat", (p) => p.parseBoolean());
    p.parseFieldOrUndefined("color")?.setField(im, "color", parseColor);
    p.parseFieldOrUndefined("priority")?.setField(im, "priority", (p) => p.parseBoundedNumber(0, 20));
    p.parseFieldOrUndefined("permissions")?.setField(im, "permissions", parsePermissions);

    warnUnused(p, ["name", "tag", "tagShownInChat", "color", "priority", "permissions"]);
    return im;
}

export function parseImportableCommand(p: Parser): ImportableCommand {
    const im: ImportableCommand = { type: "COMMAND" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", p => p.parseString());
    const actionsField = p.parseFieldOrUndefined("actions");
    actionsField?.setField(im, "actions", parseHtsl);
    if (actionsField) {
        im.sourcePath = contentFilePath(actionsField);
        im.actionsPath = im.sourcePath;
    }
    p.parseFieldOrUndefined("mode")?.setField(im, "mode", parseCommandMode);
    p.parseFieldOrUndefined("requiredPriority")?.setField(im, "requiredPriority", p => p.parseBoundedNumber(0, 20));
    p.parseFieldOrUndefined("listed")?.setField(im, "listed", p => p.parseBoolean());

    warnUnused(p, ["name", "actions", "mode", "requiredPriority", "listed"]);
    return im;
}

export function parseImportableNpc(p: Parser): ImportableNpc {
    const im: ImportableNpc = { type: "NPC" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseField("pos").setField(im, "pos", parsePos);
    const leftField = p.parseFieldOrUndefined("leftClickActions");
    leftField?.setField(im, "leftClickActions", parseHtsl);
    if (leftField) im.leftClickActionsPath = contentFilePath(leftField);
    const rightField = p.parseFieldOrUndefined("rightClickActions");
    rightField?.setField(im, "rightClickActions", parseHtsl);
    if (rightField) im.rightClickActionsPath = contentFilePath(rightField);
    p.parseFieldOrUndefined("leftClickRedirect")?.setField(im, "leftClickRedirect", (p) => p.parseBoolean());
    p.parseFieldOrUndefined("lookAtPlayers")?.setField(im, "lookAtPlayers", (p) => p.parseBoolean());
    p.parseFieldOrUndefined("hideNameTag")?.setField(im, "hideNameTag", (p) => p.parseBoolean());
    p.parseFieldOrUndefined("skin")?.setField(im, "skin", parseNpcSkin);
    p.parseFieldOrUndefined("equipment")?.setField(im, "equipment", parseNpcEquipment);

    warnUnused(p, [
        "name",
        "pos",
        "leftClickActions",
        "rightClickActions",
        "leftClickRedirect",
        "lookAtPlayers",
        "hideNameTag",
        "skin",
        "equipment",
    ]);
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
    p.parseFieldOrUndefined("helmet")?.setField(equipment, "helmet", (p) => p.parseString());
    p.parseFieldOrUndefined("chestplate")?.setField(equipment, "chestplate", (p) => p.parseString());
    p.parseFieldOrUndefined("leggings")?.setField(equipment, "leggings", (p) => p.parseString());
    p.parseFieldOrUndefined("boots")?.setField(equipment, "boots", (p) => p.parseString());
    p.parseFieldOrUndefined("hand")?.setField(equipment, "hand", (p) => p.parseString());
    warnUnused(p, ["helmet", "chestplate", "leggings", "boots", "hand"]);
    return equipment;
}
