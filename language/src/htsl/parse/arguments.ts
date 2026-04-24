import type {
    Operation,
    Value,
    Location,
    Comparison,
    DamageCause,
    FishingEnvironment,
    Gamemode,
    InventorySlot,
    PotionEffect,
    Sound,
    Lobby,
    Enchantment,
    Permission,
    ItemProperty,
    ItemLocation,
    ItemAmount,
    PortalType,
    VarOperation,
} from "../../types";
import type { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import type { F64Kind, I64Kind, PlaceholderKind, StrKind, Token } from "./token";
import { parseNumericalPlaceholder, validateNumericalPlaceholder } from "./placeholders";
import {
    COMPARISONS,
    DAMAGE_CAUSES,
    ENCHANTMENTS,
    FISHING_ENVIRONMENTS,
    GAMEMODES,
    INVENTORY_SLOTS,
    ITEM_AMOUNTS,
    ITEM_LOCATIONS,
    ITEM_PROPERTIES,
    LOBBIES,
    LOCATIONS,
    OPERATIONS,
    PERMISSIONS,
    PORTAL_TYPES,
    POTION_EFFECTS,
    SOUNDS,
    VAR_OPERATIONS,
} from "../../types/constants";
import { Span } from "../../span";
import { SHORTHANDS } from "./helpers";
import { Long } from "../../long";

function normalizeNumberLiteral(value: string): string {
    return value.replaceAll("_", "");
}

export function parseLocation(p: Parser): Location {
    const type = p.parseOption(
        LOCATIONS,
        { singular: "location", plural: "locations" }
    );

    if (type === "Custom Coordinates") {
        const value = parseCoordinates(p);
        return { type, value };
    } else {
        return { type };
    }
}

export function parseGamemode(p: Parser): Gamemode {
    return p.parseOption(
        GAMEMODES,
        { singular: "gamemode", plural: "gamemodes" }
    );
}

export function parseComparison(p: Parser): Comparison {
    if (
        p.eat({ kind: "cmp_op", op: "equals" }) ||
        p.eat({ kind: "cmp_op_eq", op: "equals" })
    ) {
        return "Equal";
    }
    if (p.eat({ kind: "cmp_op", op: "less_than" })) {
        return "Less Than";
    }
    if (p.eat({ kind: "cmp_op_eq", op: "less_than" })) {
        return "Less Than or Equal";
    }
    if (p.eat({ kind: "cmp_op", op: "greater_than" })) {
        return "Greater Than";
    }
    if (p.eat({ kind: "cmp_op_eq", op: "greater_than" })) {
        return "Greater Than or Equal";
    }

    if (p.check("ident") || p.check("str")) {
        return p.parseOption(
            COMPARISONS,
            { singular: "comparison", plural: "comparisons" }
        );
    } else {
        const err = Diagnostic.error("Expected comparison")
            .addPrimarySpan(p.token.span);

        err.addSubDiagnostic(
            Diagnostic.help("Valid comparisons are: ==, <, <=, >, >=")
        );

        throw err;
    }
}

export function parseOperation(p: Parser): Operation {
    // First try to parse alternatives
    if (
        p.eatIdent("Inc", true) ||
        p.eat({ kind: "bin_op_eq", op: "plus" })
    ) {
        return "Increment";
    }
    if (
        p.eatIdent("Dec", true) ||
        p.eat({ kind: "bin_op_eq", op: "minus" })
    ) {
        return "Decrement";
    }
    if (
        p.eatIdent("Mult", true) ||
        p.eatIdent("Mul", true) ||
        p.eat({ kind: "bin_op_eq", op: "star" })
    ) {
        return "Multiply";
    }
    if (
        p.eatIdent("Div", true) ||
        p.eat({ kind: "bin_op_eq", op: "slash" })
    ) {
        return "Divide";
    }
    if (p.eat({ kind: "cmp_op", op: "equals" })) {
        return "Set";
    }

    if (p.check("ident") || p.check("str")) {
        // Now parse real options
        return p.parseOption(
            OPERATIONS,
            { singular: "operation", plural: "operations" }
        );
    } else {
        // or, we give them the symbol version of the diagnostic
        const err = Diagnostic.error("Expected operation")
            .addPrimarySpan(p.token.span);

        err.addSubDiagnostic(
            Diagnostic.help("Valid operations are: =, +=, -=, *=, /=")
        );

        throw err;
    }
}

export function parseVarName(p: Parser): string {
    if (p.token.kind !== "ident" && p.token.kind !== "str") {
        throw Diagnostic.error("Expected var name")
            .addPrimarySpan(p.token.span);
    }

    const value = p.token.value;

    const maybeErr = Diagnostic.error("Invalid var name");
    if (value.length > 16) {
        p.gcx.addDiagnostic(
            maybeErr.addPrimarySpan(p.token.span, "Exceeds 16-character limit")
        );
    }
    else if (value.length < 1) {
        p.gcx.addDiagnostic(
            maybeErr.addPrimarySpan(p.token.span, "Cannot be empty")
        );
    }
    else if (value.includes(" ")) {
        p.gcx.addDiagnostic(
            maybeErr.addPrimarySpan(p.token.span, "Cannot contain spaces")
        );
    }

    p.next();
    return value;
}

export function parseVarOperation(p: Parser): VarOperation {
    try {
        return parseOperation(p);
    } catch (e) {
        // Ignore the diagnostic
    }

    if (
        p.eatIdent("Shl", true) ||
        p.eat({ kind: "bin_op_eq", op: "lt_lt" })
    ) {
        return "Shift Left";
    }
    if (
        p.eatIdent("Shr", true) ||
        p.eat({ kind: "bin_op_eq", op: "gt_gt" })
    ) {
        return "Shift Right";
    }
    if (p.eat({ kind: "bin_op_eq", op: "ampersand" })) {
        return "And Assign";
    }
    if (p.eat({ kind: "bin_op_eq", op: "vertical_bar" })) {
        return "Or Assign";
    }
    if (p.eat({ kind: "bin_op_eq", op: "caret" })) {
        return "Xor Assign";
    }

    if (p.check("ident") || p.check("str")) {
        // Now parse real options
        return p.parseOption(
            [...OPERATIONS, ...VAR_OPERATIONS],
            { singular: "var operation", plural: "var operations" }
        );
    } else {
        // or, we give them the symbol version of the diagnostic
        const err = Diagnostic.error("Expected operation")
            .addPrimarySpan(p.token.span);

        err.addSubDiagnostic(
            Diagnostic.help("Valid operations are: =, +=, -=, *=, /=, <<=, >>=, &=, |=, ^=, Unset")
        );

        throw err;
    }
}

export function parseNumericValue(p: Parser): Value {
    const negative = p.eat({ kind: "bin_op", op: "minus" });

    const maybeErr = Diagnostic.error("Invalid amount");

    if (p.eat("i64")) {
        const value = normalizeNumberLiteral((p.prev as I64Kind).value);
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw maybeErr.addPrimarySpan(p.prev.span, "Number exceeds 64-bit integer limit");
        }

        return long.toString();
    } else if (p.eat("f64")) {
        const value = normalizeNumberLiteral((p.prev as F64Kind).value);
        const withNegative = negative ? `-${value}` : value;
        const double = parseFloat(withNegative);

        return double.toFixed(20);
    } else if (negative) {
        throw maybeErr.addPrimarySpan(p.token.span, "Expected number");
    }

    if (p.check("str")) {
        const token = p.token as Extract<Token, { kind: "str" }>;
        const value = token.value;
        const normalizedValue = normalizeNumberLiteral(value);

        if (/^-?\d+$/.test(normalizedValue)) {
            p.next();
            const long = Long.fromString(normalizedValue);

            if (normalizedValue != long.toString()) {
                throw maybeErr.addPrimarySpan(token.span, "Number exceeds 64-bit integer limit");
            }

            return long.toString();
        }

        if (normalizedValue.includes(".") && !isNaN(Number(normalizedValue))) {
            p.next();
            return parseFloat(normalizedValue).toFixed(20);
        }

        const castMatch = value.match(/^(%(.+)%)\s*([LD])$/i);
        if (castMatch) {
            p.next();
            validateNumericalPlaceholder(p, castMatch[2], token.span);
            return `"${value}"`;
        }
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

    throw Diagnostic.error("Expected amount")
        .addPrimarySpan(p.token.span);
}

export function parseValue(p: Parser): Value {
    if (p.check("str")) {
        return `"${p.parseString()}"`;
    }

    if (p.eat("placeholder")) {
        return `%${(p.prev as PlaceholderKind).value}%`;
    }

    return parseNumericValue(p);
}

export function parseInventorySlot(p: Parser): InventorySlot {
    if (!p.check("i64") && !p.check("ident") && !p.check("str")) {
        throw Diagnostic.error("Expected inventory slot name or index")
            .addPrimarySpan(p.token.span);
    }

    if (p.check("i64")) {
        return p.parseBoundedNumber(-1, 39);
    }

    if (p.eatString("First Slot") || p.eatIdent("first_slot", true)) {
        return "First Available Slot";
    }

    if (p.eatString("Hand") || p.eatIdent("hand", true)) {
        return "Hand Slot";
    }

    if (p.check("str")) {
        const value = (p.token as StrKind).value;
        const hotbarMatch = value.match(/^hotbar slot ([1-9])$/i);
        if (hotbarMatch) {
            p.next();
            return Number(hotbarMatch[1]) - 1;
        }

        const inventoryMatch = value.match(/^inventory slot ([1-9]|1[0-9]|2[0-7])$/i);
        if (inventoryMatch) {
            p.next();
            return Number(inventoryMatch[1]) + 8;
        }
    }

    return p.parseOption(
        INVENTORY_SLOTS,
        { singular: "inventory slot name", plural: "inventory slot names" }
    );
}

export function parsePotionEffect(p: Parser): PotionEffect {
    return p.parseOption(
        POTION_EFFECTS,
        { singular: "potion effect", plural: "potion effects" }
    );
}

export function parseLobby(p: Parser): Lobby {
    return p.parseOption(
        LOBBIES,
        { singular: "lobby", plural: "lobbies" }
    );
}

export function parseEnchantment(p: Parser): Enchantment {
    return p.parseOption(
        ENCHANTMENTS,
        { singular: "enchantment", plural: "enchantments" }
    );
}

export function parseSound(p: Parser): Sound {
    if (p.check("ident")) {
        // save the token for an error, because parseOption can technically
        // advance the token in rare scenarios
        const token = p.token as Extract<Token, { kind: "ident" }>;

        try {
            const name = p.parseOption(
                SOUNDS.map(it => it.name),
                { singular: "sound name", plural: "sound names" }
            );

            // return the sound path
            return SOUNDS.find(it => it.name == name)!.path;
        } catch (err) {
            if (err instanceof Diagnostic && err.level === "error") {
                // catch unquoted sound paths (probably)
                if (token.value.includes(".")) {
                    err.addSubDiagnostic(
                        Diagnostic.help("Surround this sound key in quotes")
                            .addEdit(token.span, `"${token.value}"`)
                    );
                }
            }
            throw err;
        }
    } else if (p.check("str")) {
        const value = (p.token as StrKind).value;
        for (const sound of SOUNDS) {
            if (
                value.toLowerCase() === sound.name.toLowerCase() ||
                value.toLowerCase() === sound.name.replaceAll(" ", "_").toLowerCase()
            ) {
                p.next();
                return sound.path;
            }
        }

        if (value.includes(" ") || !value.includes(".")) {
            p.gcx.addDiagnostic(
                Diagnostic.error("Invalid sound key")
                    .addPrimarySpan(p.token.span)
            );
        }

        p.next();
        return value as Sound;
    } else {
        throw Diagnostic.error("Expected sound name or sound key")
            .addPrimarySpan(p.token.span);
    }
}

export function parsePermission(p: Parser): Permission {
    return p.parseOption(
        PERMISSIONS,
        { singular: "permission", plural: "permissions" }
    );
}

export function parseDamageCause(p: Parser): DamageCause {
    return p.parseOption(
        DAMAGE_CAUSES,
        { singular: "damage cause", plural: "damage causes" }
    );
}

export function parseFishingEnvironment(p: Parser): FishingEnvironment {
    return p.parseOption(
        FISHING_ENVIRONMENTS,
        {
            singular: "fishing environment",
            plural: "fishing environments",
        }
    );
}

export function parsePortalType(p: Parser): PortalType {
    return p.parseOption(
        PORTAL_TYPES,
        { singular: "portal type", plural: "portal types" }
    );
}

export function parseItemProperty(p: Parser): ItemProperty {
    return p.parseOption(
        ITEM_PROPERTIES,
        { singular: "item property", plural: "item properties" }
    );
}

export function parseItemLocation(p: Parser): ItemLocation {
    return p.parseOption(
        ITEM_LOCATIONS,
        { singular: "item location", plural: "item locations" }
    );
}

export function parseItemAmount(p: Parser): ItemAmount {
    return p.parseOption(
        ITEM_AMOUNTS,
        { singular: "item amount", plural: "item amounts" }
    );
}

export function parseCoordinates(p: Parser) {
    if (p.token.kind !== "str") {
        throw Diagnostic.error("Expected coordinates")
            .addPrimarySpan(p.token.span);
    }

    let value = p.token.value;
    const sp = p.token.span;
    p.next();

    const tokens = value.split(" ");

    function addDiagnostic(message: string, span: Span) {
        p.gcx.addDiagnostic(Diagnostic.error(message)
            .addPrimarySpan(span));
    }

    const isNumeric = (s: string) => !isNaN(Number(normalizeNumberLiteral(s)));
    const isPlaceholder = (s: string, span: Span) => {
        const match = s.match(/^%(.+)%[LD]?$/i);
        if (!match) return false;
        validateNumericalPlaceholder(p, match[1], span);
        return true;
    };
    const isNumericOrPlaceholder = (s: string, span: Span) =>
        isNumeric(s) || isPlaceholder(s, span);
    const isRelative = (s: string, span: Span) =>
        (s.startsWith("~") || s.startsWith("^")) &&
        (s.length == 1 || isNumericOrPlaceholder(s.substring(1), span));

    let offset = 0;
    const components = tokens.map((token, index) => {
        const start = offset + 1;
        offset += token.length + 1;
        const end = start + token.length;

        const tokenSpan = new Span(sp.start + start, sp.start + end);
        const isValid = isRelative(token, tokenSpan) || isNumericOrPlaceholder(token, tokenSpan);
        if (!isValid) {
            addDiagnostic("Invalid component", tokenSpan);
        }
        return { token, isRelative: isRelative(token, tokenSpan), index, span: tokenSpan };
    });

    if (components.length < 3) {
        addDiagnostic("Expected 3 components", new Span(sp.start, sp.end));
        return "";
    }

    const coordinateComponents = components.slice(0, 3);
    const allDirectional = coordinateComponents.every(c => c.token.startsWith("^"));
    const anyDirectional = coordinateComponents.some(c => c.token.startsWith("^"));
    if (anyDirectional && !allDirectional) {
        addDiagnostic("All components must be directional", sp);
    }

    const requiresPitchYaw = components.length === 5;
    if (components.length > 3 && !requiresPitchYaw) {
        addDiagnostic("Expected yaw", components[3].span);
    }

    if (requiresPitchYaw) {
        const yaw = components[3];
        if (!isNumericOrPlaceholder(yaw.token, yaw.span)) {
            addDiagnostic("Invalid yaw", yaw.span);
        }
        const pitch = components[4];
        if (!isNumericOrPlaceholder(pitch.token, pitch.span)) {
            addDiagnostic("Invalid pitch", pitch.span);
        }
    }

    return value;
}
