import type {
    ImportableCommand,
    ImportableEvent,
    ImportableFunction,
    ImportableGroup,
    ImportableHouseName,
    ImportableItem,
    ImportableMenu,
    ImportableRegion,
    ImportableTeam,
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
} from "./arguments";
import { warnUnused } from "./helpers";
import type { Parser } from "./parser";

export function parseImportableFunction(p: Parser): ImportableFunction {
    const im: ImportableFunction = { type: "FUNCTION" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", (p) => p.parseString());
    p.parseFieldOrUndefined("actions")?.setField(im, "actions", parseHtsl);
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
    p.parseField("bounds").setField(im, "bounds", parseBounds);
    p.parseFieldOrUndefined("onEnterActions")?.setField(im, "onEnterActions", parseHtsl);
    p.parseFieldOrUndefined("onExitActions")?.setField(im, "onExitActions", parseHtsl);

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
    p.parseField("nbt").setField(im, "nbt", parseSnbt);
    p.parseFieldOrUndefined("leftClickActions")?.setField(im, "leftClickActions", parseHtsl);
    p.parseFieldOrUndefined("rightClickActions")?.setField(im, "rightClickActions", parseHtsl);

    warnUnused(p, ["name", "nbt", "leftClickActions", "rightClickActions"]);
    return im;
}

export function parseImportableEvent(p: Parser): ImportableEvent {
    const im: ImportableEvent = { type: "EVENT" } as any;
    p.setNodeSpan(im);

    p.parseField("event").setField(im, "event", parseEvent);
    p.parseField("actions").setField(im, "actions", parseHtsl);

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
    p.parseFieldOrUndefined("color")?.setField(im, "color", parseColor);
    p.parseFieldOrUndefined("priority")?.setField(im, "priority", (p) => p.parseBoundedNumber(0, 20));
    p.parseFieldOrUndefined("permissions")?.setField(im, "permissions", parsePermissions);

    warnUnused(p, ["name", "tag", "color", "priority", "permissions"]);
    return im;
}

export function parseImportableCommand(p: Parser): ImportableCommand {
    const im: ImportableCommand = { type: "COMMAND" } as any;
    p.setNodeSpan(im);

    p.parseField("name").setField(im, "name", p => p.parseString());
    p.parseFieldOrUndefined("mode")?.setField(im, "mode", parseCommandMode);
    p.parseFieldOrUndefined("requiredPriority")?.setField(im, "requiredPriority", p => p.parseBoundedNumber(0, 20));
    p.parseFieldOrUndefined("listed")?.setField(im, "listed", p => p.parseBoolean());

    warnUnused(p, ["name", "mode", "requiredPriority", "listed"]);
    return im;
}