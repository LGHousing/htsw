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
    ItemAmount,
    VarOperation,
} from "../../types";
import type { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import type { F64Kind, I64Kind, StrKind, Token } from "./token";
import { parseNumericalPlaceholder } from "./placeholders";
import {
    COMPARISONS,
    ENCHANTMENTS,
    GAMEMODES,
    INVENTORY_SLOTS,
    ITEM_AMOUNTS,
    ITEM_LOCATIONS,
    ITEM_PROPERTIES,
    LOBBIES,
    LOCATIONS,
    OPERATIONS,
    PERMISSIONS,
    POTION_EFFECTS,
    SOUNDS,
    VAR_OPERATIONS,
} from "../../types/constants";
import { Span } from "../../span";
import { SHORTHANDS } from "./helpers";
import Long from "long";
import type { IrObject } from "../../ir";

export function parseLocation(p: Parser): IrObject<Location> {
    const start = p.token.span.start;

    const type = p.parseOption(
        LOCATIONS,
        { singular: "location", plural: "locations" }
    );
    const typeSpan = p.prev.span;

    if (type === "Custom Coordinates") {
        const value = p.spanned(parseCoordinates);
        return { type, value, typeSpan, span: typeSpan.to(value.span) };
    } else {
        return { type, typeSpan, span: typeSpan };
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
        return "Less Than Or Equal";
    }
    if (p.eat({ kind: "cmp_op", op: "greater_than" })) {
        return "Greater Than";
    }
    if (p.eat({ kind: "cmp_op_eq", op: "greater_than" })) {
        return "Greater Than Or Equal";
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
        const value = (p.prev as I64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const long = Long.fromString(withNegative);

        if (withNegative != long.toString()) {
            throw maybeErr.addPrimarySpan(p.prev.span, "Number exceeds 64-bit integer limit");
        }

        return long.toString();
    } else if (p.eat("f64")) {
        const value = (p.prev as F64Kind).value;
        const withNegative = negative ? `-${value}` : value;
        const double = parseFloat(withNegative);

        return double.toFixed(20);
    } else if (negative) {
        throw maybeErr.addPrimarySpan(p.token.span, "Expected number");
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
    if (!p.check("i64") && !p.check("ident") && !p.check("str")) {
        throw Diagnostic.error("Expected inventory slot name or index")
            .addPrimarySpan(p.token.span);
    }

    if (p.check("i64")) {
        return p.parseBoundedNumber(-1, 39);
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
        if (
            value.includes(" ") ||
            // this is technically wrong but if your sound key contains no
            // periods you don't deserve to have your code parse correctly
            !value.includes(".")
        ) {
            const err = Diagnostic.error("Invalid sound key")
                .addPrimarySpan(p.token.span);

            for (const { name } of SOUNDS) {
                if (p.eatString(name) || p.eatString(name.replaceAll(" ", "_"))) {

                    err.addSubDiagnostic(
                        Diagnostic.help("Convert this string to an identifier")
                            .addEdit(p.prev.span, name.replaceAll(" ", "_"))
                    );
                    break;
                }
            }

            p.gcx.addDiagnostic(err);
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
