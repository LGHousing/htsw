import type {
    Operation,
    Value,
    Location,
    Comparison,
    Gamemode,
    InventorySlot,
    PotionEffect,
    Sound,
    Lobby,
    Enchantment,
    Permission,
    ItemProperty,
    ItemLocation,
} from "../types";
import type { Parser } from "./parser";
import { error } from "../diagnostic";
import type { F64Kind, I64Kind, StrKind } from "./token";
import { parseNumericalPlaceholder } from "./placeholders";
import {
    ENCHANTMENTS,
    ITEM_LOCATIONS,
    ITEM_PROPERTIES,
    LOBBIES,
    PERMISSIONS,
    POTION_EFFECTS,
    SOUNDS,
} from "../types/helpers";
import { Span } from "../span";
import { SHORTHANDS } from "../helpers";
import Long from "long";

export function parseLocation(p: Parser): Location {
    if (p.eatOption("custom_location") || p.eatOption("custom_coordinates")) {
        const value = parseCoordinates(p);
        return { type: "location_custom", value };
    }
    if (p.eatOption("house_spawn") || p.eatOption("houseSpawn")) {
        // ???
        return { type: "location_spawn" };
    }
    if (p.eatOption("invokers_location") || p.eatOption("invokers location")) {
        return { type: "location_invokers" };
    }
    throw error("Invalid location", p.token.span);
}

export function parseGamemode(p: Parser): Gamemode {
    if (p.eatOption("survival")) {
        return "survival";
    }
    if (p.eatOption("adventure")) {
        return "adventure";
    }
    if (p.eatOption("creative")) {
        return "creative";
    }
    if (p.check("str") || p.check("ident")) {
        p.addDiagnostic(
            error("Expected gamemode (survival, adventure, creative)", p.token.span)
        );
    } else {
        p.addDiagnostic(error("Expected gamemode", p.token.span));
    }
    p.next();
    return "survival";
}

export function parseComparison(p: Parser): Comparison {
    if (
        p.eatOption("equals") ||
        p.eatOption("equal") ||
        p.eat({ kind: "cmp_op", op: "equals" }) ||
        p.eat({ kind: "cmp_op_eq", op: "equals" })
    ) {
        return "equals";
    }
    if (p.eatOption("less than") || p.eat({ kind: "cmp_op", op: "less_than" })) {
        return "less_than";
    }
    if (
        p.eatOption("less than or equals") ||
        p.eatOption("less than or equal") ||
        p.eat({ kind: "cmp_op_eq", op: "less_than" })
    ) {
        return "less_than_or_equals";
    }
    if (p.eatOption("greater than") || p.eat({ kind: "cmp_op", op: "greater_than" })) {
        return "greater_than";
    }
    if (
        p.eatOption("greater than or equals") ||
        p.eatOption("greater than or equal") ||
        p.eat({ kind: "cmp_op_eq", op: "greater_than" })
    ) {
        return "greater_than_or_equals";
    }
    if (p.check("str") || p.check("ident")) {
        p.addDiagnostic(
            error(
                "Expected comparison (less than, less than or equals, equals, greater than, greater than or equals)",
                p.token.span
            )
        );
    } else {
        p.addDiagnostic(error("Expected comparison", p.token.span));
    }
    p.next();
    return "equals";
}

export function parseVarName(p: Parser): string {
    if (p.token.kind !== "ident" && p.token.kind !== "str") {
        throw error("Expected stat name", p.token.span);
    }
    const value = p.token.value;
    if (value.length > 16) {
        throw error("Stat name exceeds 16-character limit", p.token.span);
    }
    if (value.length < 1) {
        throw error("Stat name cannot be empty", p.token.span);
    }
    if (value.includes(" ")) {
        throw error("Stat name cannot contain spaces", p.token.span);
    }
    p.next();
    return value;
}

export function parseOperation(p: Parser): Operation {
    if (
        p.eatOption("increment") ||
        p.eatOption("inc") ||
        p.eat({ kind: "bin_op_eq", op: "plus" })
    ) {
        return "increment";
    }
    if (
        p.eatOption("decrement") ||
        p.eatOption("dec") ||
        p.eat({ kind: "bin_op_eq", op: "minus" })
    ) {
        return "decrement";
    }
    if (
        p.eatOption("multiply") ||
        p.eatOption("mult") ||
        p.eatOption("mul") ||
        p.eat({ kind: "bin_op_eq", op: "star" })
    ) {
        return "multiply";
    }
    if (
        p.eatOption("divide") ||
        p.eatOption("div") ||
        p.eat({ kind: "bin_op_eq", op: "slash" })
    ) {
        return "divide";
    }
    if (p.eatOption("set") || p.eat({ kind: "cmp_op", op: "equals" })) {
        return "set";
    }

    if (p.check("str") || p.check("ident")) {
        throw error(
            "Expected operation (increment, decrement, set, multiply, divide)",
            p.token.span
        );
    } else {
        throw error("Expected operation", p.token.span);
    }
}

export function parseVarOperation(p: Parser): Operation | "unset" {
    if (p.eatIdent("unset")) {
        return "unset";
    }
    return parseOperation(p);
}

export function parseNumericValue(p: Parser): Value {
    const negative = p.eat({ kind: "bin_op", op: "minus" });

    if (p.eat("i64")) {
        const value = (p.prev as I64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw error("Number exceeds 64-bit integer limit", p.prev.span);
        }

        return long.toString();
    } else if (p.eat("f64")) {
        const value = (p.prev as F64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const double = parseFloat(withNegative);

        return double.toFixed(20);
    } else if (negative) {
        throw error("Expected number", p.token.span);
    }

    let isShorthand = false;
    for (const shorthand of SHORTHANDS) {
        if (p.check({ kind: "ident", value: shorthand })) {
            isShorthand = true;
        }
    }

    if (isShorthand || p.check("placeholder") || p.check("str")) {
        return parseNumericalPlaceholder(p);
    }

    throw error("Expected amount", p.token.span);
}

export function parseValue0(p: Parser): Value {
    if (p.check("str")) {
        return `"${p.parseString()}"`;
    }

    return parseNumericValue(p);
}

export function parseValue(p: Parser): Value {
    const value = parseValue0(p);

    if (p.eatIdent("D")) {}
    else if (p.eatIdent("L")) {}

    return value;
}


export function parseInventorySlot(p: Parser): InventorySlot {
    if (p.check("i64")) {
        return p.parseBoundedNumber(-1, 39);
    }

    if (p.eatOption("helmet")) {
        return "helmet";
    }
    if (p.eatOption("chestplate")) {
        return "chestplate";
    }
    if (p.eatOption("leggings")) {
        return "leggings";
    }
    if (p.eatOption("boots")) {
        return "boots";
    }
    if (p.eatOption("first available slot") || p.eatOption("first slot")) {
        return "first";
    }
    if (p.eatOption("hand slot")) {
        return "hand";
    }

    if (p.check("str") || p.check("ident")) {
        throw error(
            "Expected inventory slot (helmet, chestplate, leggings, boots, first slot, hand slot)",
            p.token.span
        );
    } else {
        throw error("Expected inventory slot", p.token.span);
    }
}

export function parsePotionEffect(p: Parser): PotionEffect {
    for (const potionEffect of POTION_EFFECTS) {
        if (p.eatOption(potionEffect)) {
            return potionEffect;
        }
    }

    throw error("Expected potion effect", p.token.span);
}

export function parseLobby(p: Parser): Lobby {
    for (const lobby of LOBBIES) {
        if (p.eatOption(lobby)) {
            return lobby;
        }
    }

    throw error("Expected lobby", p.token.span);
}

export function parseEnchantment(p: Parser): Enchantment {
    for (const enchantment of ENCHANTMENTS) {
        if (p.eatOption(enchantment)) {
            return enchantment;
        }
    }

    throw error("Expected enchantment", p.token.span);
}

export function parseSound(p: Parser): Sound {
    if (!p.check("str")) {
        throw error("Expected sound", p.token.span);
    }

    const value = (p.token as StrKind).value;
    p.next();

    for (const sound of SOUNDS) {
        if (sound.name === value) return sound.path;
        if (sound.path === value) return sound.path;
    }

    return value as Sound; // this is stupid but whatever
}

export function parsePermission(p: Parser): Permission {
    for (const permission of PERMISSIONS) {
        if (p.eatOption(permission)) {
            return permission;
        }
    }

    throw error("Expected permission", p.token.span);
}

export function parseItemProperty(p: Parser): ItemProperty {
    for (const property of ITEM_PROPERTIES) {
        if (p.eatOption(property)) {
            return property;
        }
    }

    throw error("Expected item property", p.token.span);
}

export function parseItemLocation(p: Parser): ItemLocation {
    for (const location of ITEM_LOCATIONS) {
        if (p.eatOption(location)) {
            return location;
        }
    }

    throw error("Expected item location", p.token.span);
}

export function parseCoordinates(p: Parser) {
    if (p.token.kind !== "str") {
        throw error("Expected coordinates", p.token.span);
    }

    let value = p.token.value;
    const sp = p.token.span;
    p.next();

    const tokens = value.split(" ");

    function addDiagnostic(message: string, span: Span) {
        p.addDiagnostic(error(message, span));
    }

    const isRelative = (s: string) =>
        (s.startsWith("~") || s.startsWith("^")) &&
        (s.length == 1 || isNumeric(s.substring(1)));
    const isNumeric = (s: string) => !isNaN(parseFloat(s));

    let offset = 0;
    const components = tokens.map((token, index) => {
        const start = offset + 1;
        offset += token.length + 1;
        const end = start + token.length;

        const tokenSpan = new Span(sp.start + start, sp.start + end);
        const isValid = isRelative(token) || isNumeric(token);
        if (!isValid) {
            addDiagnostic("Invalid component", tokenSpan);
        }
        return { token, isRelative: isRelative(token), index, span: tokenSpan };
    });

    if (components.length < 3) {
        addDiagnostic("Expected 3 components", new Span(sp.start, sp.end));
        return "";
    }

    const allDirectional = components.every((c) => c.token.startsWith("^"));
    const anyDirectional = components.some((c) => c.token.startsWith("^"));
    if (anyDirectional && !allDirectional) {
        addDiagnostic("All components must be directional", sp);
    }

    const requiresPitchYaw = components.length === 5;
    if (components.length > 3 && !requiresPitchYaw) {
        addDiagnostic("Expected yaw", components[3].span);
    }

    if (requiresPitchYaw) {
        const pitch = components[4];
        if (!isNumeric(pitch.token)) {
            addDiagnostic("Invalid pitch", pitch.span);
        }
        const yaw = components[4];
        if (!isNumeric(yaw.token)) {
            addDiagnostic("Invalid pitch", yaw.span);
        }
    }

    return value;
}
