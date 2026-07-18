import { Diagnostic } from "../../diagnostic";
import type { Action, Bounds, ChatSpeed, Color, CommandMode, DefaultGameMode, Event, FunctionIcon, MenuSlot, Permission, Pos } from "../../types";
import { CHAT_SPEEDS, COLORS, COMMAND_MODES, DEFAULT_GAME_MODES, EVENTS, MINECRAFT_ITEMS, PERMISSIONS } from "../../types/constants";
import type { Parser } from "./parser";
import { contentFilePath, getFileName, parseOption } from "./helpers";
import { parseHtsl as parseHtslImpl } from "../../htsl";
import { parseSnbt as parseSnbtImpl } from "../../nbt/parse";
import type { Tag } from "../../nbt/types";
import { isUnspawnableItem } from "../../check/unspawnableItems";

export function parseHtsl(p: Parser): Action[] {
    const path = p.parseString();
    const fileName = getFileName(path);

    if (!path.endsWith(".htsl")) {
        throw Diagnostic.error("Invalid actions file: expected a `.htsl` file")
            .addPrimarySpan(p.span(), "Expected a `.htsl` file");
    }

    if (!p.gcx.fileExists(path)) {
        throw Diagnostic.error(`Couldn't read \`${fileName}\` file`)
            .addPrimarySpan(p.span(), "No such file");
    }

    const resolved = p.gcx.resolvePath(path);
    return parseHtslImpl(p.gcx.subContext(path), resolved);
}

export function parseSnbt(p: Parser): Tag {
    const path = p.parseString();
    const fileName = getFileName(path);

    if (!path.endsWith(".snbt")) {
        throw Diagnostic.error("Invalid NBT file: expected a `.snbt` file")
            .addPrimarySpan(p.span(), "Expected a `.snbt` file");
    }

    if (!p.gcx.fileExists(path)) {
        throw Diagnostic.error(`Couldn't read \`${fileName}\` file`)
            .addPrimarySpan(p.span(), "No such file");
    }

    const resolvedSnbt = p.gcx.resolvePath(path);
    const tag = parseSnbtImpl(p.gcx.subContext(path), resolvedSnbt);

    if (tag === undefined) {
        if (!p.gcx.isFailed()) throw Error("parseSnbt returned undefined with no diagnostics");
        throw Diagnostic.error("Failed to parse SNBT file")
            .addPrimarySpan(p.span());
    }

    return tag;
}

export function parseFunctionIcon(p: Parser): FunctionIcon {
    const item = parseMinecraftItemId(p.parseField("item"));
    const count = p.parseFieldOrUndefined("count")?.parseBoundedNumber(1, 64) ?? 1;
    return { item, count };
}

function parseMinecraftItemId(p: Parser): string {
    const value = p.parseString();
    const colon = value.indexOf(":");
    const namespace = colon >= 0 ? value.slice(0, colon) : "minecraft";
    const name = colon >= 0 ? value.slice(colon + 1) : value;

    if (namespace === "minecraft") {
        for (let i = 0; i < MINECRAFT_ITEMS.length; i++) {
            if (MINECRAFT_ITEMS[i].name === name) {
                if (isUnspawnableItem(name)) {
                    p.gcx.addDiagnostic(
                        Diagnostic.error("Hypixel refuses to spawn this item, so it can't be used as an icon.")
                            .addPrimarySpan(p.span())
                    );
                }
                return `minecraft:${name}`;
            }
        }
    }

    p.gcx.addDiagnostic(
        Diagnostic.error(`Unknown Minecraft 1.8 item: \`${value}\``)
            .addPrimarySpan(p.span())
    );
    return value;
}

const HOUSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[a-z0-9 ]*$/i;

export function parseTag(p: Parser): string {
    const tag = p.parseString();

    if (!TAG_RE.test(tag)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Tags can only contain numbers, letters, and spaces")
                .addPrimarySpan(p.span())
        );
    }

    return tag;
}

function parseUuid(p: Parser): string {
    const uuid = p.parseString();

    if (!HOUSE_UUID_RE.test(uuid)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Expected UUID").addPrimarySpan(p.span())
        );
    }

    return uuid;
}

export function parsePos(p: Parser): Pos {
    return {
        x: p.parseField("x").parseNumber(),
        y: p.parseField("y").parseNumber(),
        z: p.parseField("z").parseNumber(),
    };
}

export function parseBounds(p: Parser): Bounds {
    return {
        from: p.parseField("from").setField({} as Bounds, "from", parsePos),
        to: p.parseField("to").setField({} as Bounds, "to", parsePos),
    } as Bounds;
}

export function parseMenuSlots(p: Parser): MenuSlot[] {
    return p.parseArray().map(sp => {
        const nbtField = sp.parseField("nbt");
        const slot: MenuSlot = {
            slot: sp.parseField("slot").parseNumber(),
            nbt: nbtField.setField({} as MenuSlot, "nbt", parseSnbt),
        };
        slot.nbtPath = contentFilePath(nbtField);
        const actionsField = sp.parseFieldOrUndefined("actions");
        actionsField?.setField(slot, "actions", parseHtsl);
        if (actionsField) slot.actionsPath = contentFilePath(actionsField);
        return slot;
    });
}

export function parseEvent(p: Parser): Event {
    return parseOption(p, EVENTS, { singular: "event", plural: "events" });
}

export function parseColor(p: Parser): Color {
    return parseOption(p, COLORS, { singular: "color", plural: "colors" });
}

export function parseCommandMode(p: Parser): CommandMode {
    return parseOption(p, COMMAND_MODES, { singular: "command mode", plural: "command modes" });
}

export function parsePermissions(p: Parser): Record<Permission, boolean> {
    const perms = {} as Record<Permission, boolean>;
    for (const { key, value } of p.parseFields()) {
        const k = parseOption(key, PERMISSIONS, { singular: "permission", plural: "permissions" });
        perms[k] = value.parseBoolean();
    }
    return perms;
}

export function parseChatSpeed(p: Parser): ChatSpeed {
    return parseOption(p, CHAT_SPEEDS, { singular: "chat speed", plural: "chat speeds" });
}

export function parseDefaultGameMode(p: Parser): DefaultGameMode {
    return parseOption(p, DEFAULT_GAME_MODES, { singular: "game mode", plural: "game modes" });
}
