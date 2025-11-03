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
} from "../../types";
import type { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
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
} from "../../types/helpers";
import { Span } from "../../span";
import { SHORTHANDS } from "./constants";
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

    const err = Diagnostic.error("Expected location")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid locations are:");
        err.hint("  house_spawn");
        err.hint("  invokers_location");
        err.hint("  custom_location <x> <y> <z> <pitch?> <yaw?>");
    }

    throw err;
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

    const err = Diagnostic.error("Expected gamemode")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid gamemodes are: survival, adventure, creative")
    }

    throw err;
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

    const err = Diagnostic.error("Expected comparison")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid comparisons are:");
        err.hint("  equals");
        err.hint("  less_than");
        err.hint("  less_than_or_equals");
        err.hint("  greater_than");
        err.hint("  greater_than_or_equals");
    } else {
        err.hint("Valid comparisons are: ==, <, <=, >, >=");
    }

    throw err;
}

export function parseVarName(p: Parser): string {
    if (p.token.kind !== "ident" && p.token.kind !== "str") {
        throw Diagnostic.error("Expected var name").label(p.token.span);
    }

    const value = p.token.value;

    const maybeErr = Diagnostic.error("Invalid var name");
    if (value.length > 16) {
        p.addDiagnostic(
            maybeErr.label(p.token.span, "Exceeds 16-character limit")
        );
    }
    else if (value.length < 1) {
        p.addDiagnostic(
            maybeErr.label(p.token.span, "Cannot be empty")
        );
    }
    else if (value.includes(" ")) {
        p.addDiagnostic(
            maybeErr.label(p.token.span, "Cannot contain spaces")
        );
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

    const err = Diagnostic.error("Expected operation")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid operations are:");
        err.hint("  set");
        err.hint("  increment");
        err.hint("  decrement");
        err.hint("  multiply");
        err.hint("  divide");
    } else {
        err.hint("Valid operations are: =, +=, -=, *=, /=");
    }

    throw err;
}

export function parseVarOperation(p: Parser): Operation | "unset" {
    if (p.eatIdent("unset")) {
        return "unset";
    }
    return parseOperation(p);
}

export function parseNumericValue(p: Parser): Value {
    const negative = p.eat({ kind: "bin_op", op: "minus" });

    const maybeErr = Diagnostic.error("Invalid amount");

    if (p.eat("i64")) {
        const value = (p.prev as I64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw maybeErr.label(p.prev.span, "Number exceeds 64-bit integer limit");
        }

        return long.toString();
    } else if (p.eat("f64")) {
        const value = (p.prev as F64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const double = parseFloat(withNegative);

        return double.toFixed(20);
    } else if (negative) {
        throw maybeErr.label(p.token.span, "Expected number");
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

    throw Diagnostic.error("Expected amount").label(p.token.span);
}

export function parseValue0(p: Parser): Value {
    if (p.check("str")) {
        return `"${p.parseString()}"`;
    }

    return parseNumericValue(p);
}

export function parseValue(p: Parser): Value {
    const value = parseValue0(p);

    if (p.eatIdent("D")) { }
    else if (p.eatIdent("L")) { }

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
    if (p.eatOption("first available slot") || p.eatOption("first slot")
        || p.eatOption("first_available_slot") || p.eatOption("first_slot")) {
        return "first";
    }
    if (p.eatOption("hand slot") || p.eatOption("hand_slot")) {
        return "hand";
    }

    const err = Diagnostic.error("Expected inventory slot")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid inventory slots are:");
        err.hint("  helmet");
        err.hint("  chestplate");
        err.hint("  leggings");
        err.hint("  boots");
        err.hint("  first_slot");
        err.hint("  hand_slot");
    }

    throw err;
}

export function parsePotionEffect(p: Parser): PotionEffect {
    for (const potionEffect of POTION_EFFECTS) {
        if (p.eatString(potionEffect)) {
            return potionEffect;
        }
    }

    const err = Diagnostic.error("Expected potion effect")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid potion effects are:")
        for (let i = 0; i < 5; i++) {
            err.hint(`  ${POTION_EFFECTS[i]}`);
        }
        err.hint(`And ${POTION_EFFECTS.length - 5} others`);
    }

    throw err;
}

export function parseLobby(p: Parser): Lobby {
    for (const lobby of LOBBIES) {
        if (p.eatOption(lobby)) {
            return lobby;
        }
    }

    const err = Diagnostic.error("Expected lobby")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid lobbies are:")
        for (let i = 0; i < 5; i++) {
            err.hint(`  ${LOBBIES[i]}`);
        }
        err.hint(`And ${LOBBIES.length - 5} others`);
    }

    throw err;
}

export function parseEnchantment(p: Parser): Enchantment {
    for (const enchantment of ENCHANTMENTS) {
        if (p.eatOption(enchantment)) {
            return enchantment;
        }
    }

    const err = Diagnostic.error("Expected enchantment")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid enchantments are:")
        for (let i = 0; i < 5; i++) {
            err.hint(`  ${ENCHANTMENTS[i]}`);
        }
        err.hint(`And ${ENCHANTMENTS.length - 5} others`);
    }

    throw err;
}

export function parseSound(p: Parser): Sound {
    if (!p.check("str")) {
        throw Diagnostic.error("Expected sound").label(p.token.span);
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

    const err = Diagnostic.error("Expected permission")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid permissions are:")
        for (let i = 0; i < 5; i++) {
            err.hint(`  ${PERMISSIONS[i]}`);
        }
        err.hint(`And ${PERMISSIONS.length - 5} others`);
    }

    throw err;
}

export function parseItemProperty(p: Parser): ItemProperty {
    for (const property of ITEM_PROPERTIES) {
        if (p.eatOption(property)) {
            return property;
        }
    }

    const err = Diagnostic.error("Expected item property")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid item properties are:")
        err.hint(`  ${ITEM_PROPERTIES[0]}`);
        err.hint(`  ${ITEM_PROPERTIES[1]}`);
    }

    throw err;
}

export function parseItemLocation(p: Parser): ItemLocation {
    for (const location of ITEM_LOCATIONS) {
        if (p.eatOption(location)) {
            return location;
        }
    }

    const err = Diagnostic.error("Expected item location")
        .label(p.token.span);

    if (p.check("str") || p.check("ident")) {
        err.hint("Valid item locations are:")
        for (let i = 0; i < 5; i++) {
            err.hint(`  ${ITEM_LOCATIONS[i]}`);
        }
        err.hint(`And ${ITEM_LOCATIONS.length - 5} others`);
    }

    throw err;
}

export function parseCoordinates(p: Parser) {
    if (p.token.kind !== "str") {
        throw Diagnostic.error("Expected coordinates").label(p.token.span);
    }

    let value = p.token.value;
    const sp = p.token.span;
    p.next();

    const tokens = value.split(" ");

    function addDiagnostic(message: string, span: Span) {
        p.addDiagnostic(Diagnostic.error(message).label(span));
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

    const allDirectional = components.every(c => c.token.startsWith("^"));
    const anyDirectional = components.some(c => c.token.startsWith("^"));
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
