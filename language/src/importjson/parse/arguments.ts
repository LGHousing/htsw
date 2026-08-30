import { Diagnostic } from "../../diagnostic";
import type { Action, Bounds, ChatSpeed, Color, CommandMode, DefaultGameMode, Event, FunctionIcon, MenuSlot, Permission, Pos } from "../../types";
import { CHAT_SPEEDS, COLORS, COMMAND_MODES, DEFAULT_GAME_MODES, EVENTS, MINECRAFT_ITEMS, PERMISSIONS } from "../../types/constants";
import type { Parser } from "./parser";
import { contentFilePath, getFileName, parseOption, warnUnused } from "./helpers";
import { parseHtsl as parseHtslImpl } from "../../htsl";
import { parseSnbt as parseSnbtImpl } from "../../nbt/parse";
import type { Tag } from "../../nbt/types";
import { isUnspawnableItem } from "../../check/unspawnableItems";
import type {
    RawBounds,
    RawFunctionIcon,
    RawMenuSlot,
    RawPos,
} from "../schemaSpec";
import {
    optionalRawField,
    parseRawFields,
    requiredRawField,
} from "./rawFields";

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
    let item = "";
    let count = 1;
    let enchanted: boolean | undefined;
    parseRawFields<RawFunctionIcon>(p, {
        item: requiredRawField((field) => {
            item = parseMinecraftItemId(field);
        }),
        count: optionalRawField((field) => {
            count = field.parseBoundedNumber(1, 64);
        }),
        enchanted: optionalRawField((field) => {
            enchanted = field.parseBoolean();
        }),
    });
    warnUnused(p);
    return {
        item,
        count,
        ...(enchanted !== undefined ? { enchanted } : {}),
    };
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

const TAG_RE = /^[a-z0-9 -]*$/i;

export function parseTag(p: Parser): string {
    const tag = p.parseString();

    if (!TAG_RE.test(tag)) {
        p.gcx.addDiagnostic(
            Diagnostic.error("Tags can only contain numbers, letters, spaces, and hyphens")
                .addPrimarySpan(p.span())
        );
    }

    return tag;
}

export function parsePos(p: Parser): Pos {
    const pos = {} as Pos;
    parseRawFields<RawPos>(p, {
        x: requiredRawField((field) => field.setField(pos, "x", (p) => p.parseInteger())),
        y: requiredRawField((field) => field.setField(pos, "y", (p) => p.parseInteger())),
        z: requiredRawField((field) => field.setField(pos, "z", (p) => p.parseInteger())),
    });
    warnUnused(p);
    return pos;
}

export function parseBounds(p: Parser): Bounds {
    const bounds = {} as Bounds;
    parseRawFields<RawBounds>(p, {
        from: requiredRawField((field) => field.setField(bounds, "from", parsePos)),
        to: requiredRawField((field) => field.setField(bounds, "to", parsePos)),
    });
    warnUnused(p);
    return bounds;
}

export function parseMenuSlots(p: Parser): MenuSlot[] {
    return p.parseArray().map(sp => {
        const slot = {} as MenuSlot;
        parseRawFields<RawMenuSlot>(sp, {
            slot: requiredRawField((field) =>
                field.setField(slot, "slot", (p) => p.parseNumber())
            ),
            nbt: requiredRawField((field) => {
                field.setField(slot, "nbt", parseSnbt);
                slot.nbtPath = contentFilePath(field);
            }),
            actions: optionalRawField((field) => {
                field.setField(slot, "actions", parseHtsl);
                slot.actionsPath = contentFilePath(field);
            }),
        });
        warnUnused(sp);
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
