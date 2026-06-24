import { Diagnostic } from "../../diagnostic";
import type { Action, Bounds, Color, Event, FunctionIcon, MenuSlot, Permission, Pos } from "../../types";
import { COLORS, EVENTS, PERMISSIONS } from "../../types/constants";
import type { Parser } from "./parser";
import { getFileName, parseOption } from "./helpers";
import { parseHtsl as parseHtslImpl } from "../../htsl";
import { parseSnbt as parseSnbtImpl } from "../../nbt/parse";
import type { Tag } from "../../nbt/types";

export function parseHtsl(p: Parser): Action[] {
    const path = p.parseString();
    const fileName = getFileName(path);

    if (!path.endsWith(".htsl")) {
        throw Diagnostic.error("Invalid actions file")
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
        throw Diagnostic.error("Invalid NBT file")
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
    const item = p.parseField("item").parseString();
    const count = p.parseFieldOrUndefined("count")?.parseBoundedNumber(1, 64) ?? 1;
    return { item, count };
}

const HOUSE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(p: Parser): string {
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
        const slot: MenuSlot = {
            slot: sp.parseField("slot").parseNumber(),
            nbt: sp.parseField("nbt").setField({} as MenuSlot, "nbt", parseSnbt),
        };
        sp.parseFieldOrUndefined("actions")?.setField(slot, "actions", parseHtsl);
        return slot;
    });
}

export function parseEvent(p: Parser): Event {
    return parseOption(p, EVENTS, { singular: "event", plural: "events" });
}

export function parseColor(p: Parser): Color {
    return parseOption(p, COLORS, { singular: "color", plural: "colors" });
}

export function parsePermissions(p: Parser): Record<Permission, boolean> {
    const perms = {} as Record<Permission, boolean>;
    for (const { key, value } of p.parseFields()) {
        const k = parseOption(key, PERMISSIONS, { singular: "permission", plural: "permissions" });
        perms[k] = value.parseBoolean();
    }
    return perms;
}
