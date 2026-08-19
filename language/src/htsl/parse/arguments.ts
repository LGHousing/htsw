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
    Coordinate,
    Coordinates,
} from "../../types";
import { Parser } from "./parser";
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
import { Lexer } from "./lexer";
import { SourceFile } from "../../sourceMap";

function normalizeNumberLiteral(value: string): string {
    return value.replaceAll("_", "");
}

function parseDecimalValueString(value: string): string {
    const parsed = parseFloat(value);
    if (parsed === 0 && value.startsWith("-")) return "0.0";

    let formatted: string | null = null;
    for (let p = 1; p <= 17; p++) {
        const candidate = parsed.toPrecision(p);
        if (candidate.indexOf("e") !== -1 || candidate.indexOf("E") !== -1) {
            continue;
        }
        if (parseFloat(candidate) === parsed) {
            formatted = candidate;
            break;
        }
    }
    if (formatted === null) {
        formatted = parsed.toFixed(20).replace(/(\.\d*?)0+$/, "$1");
        if (formatted.charAt(formatted.length - 1) === ".") {
            formatted = formatted + "0";
        }
    }

    return formatted.indexOf(".") !== -1 ? formatted : `${formatted}.0`;
}

export function parseLocation(p: Parser): Location {
    const type = p.parseOption(
        LOCATIONS,
        { singular: "location", plural: "locations" }
    );

    if (type === "Custom Coordinates") {
        const { value, coordinates } = parseCoordinates(p);
        return { type, value, coordinates };
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
        return "Left Shift";
    }
    if (
        p.eatIdent("Shr", true) ||
        p.eat({ kind: "bin_op_eq", op: "gt_gt" })
    ) {
        return "Arithmetic Right Shift";
    }
    if (
        p.eatIdent("Shru", true) ||
        p.eat({ kind: "bin_op_eq", op: "gt_gt_gt" })
    ) {
        return "Logical Right Shift";
    }
    if (p.eat({ kind: "bin_op_eq", op: "ampersand" })) {
        return "Bitwise AND";
    }
    if (p.eat({ kind: "bin_op_eq", op: "vertical_bar" })) {
        return "Bitwise OR";
    }
    if (p.eat({ kind: "bin_op_eq", op: "caret" })) {
        return "Bitwise XOR";
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

    const maybeErr = Diagnostic.error("Invalid value");

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

        return parseDecimalValueString(withNegative);
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
            return parseDecimalValueString(normalizedValue);
        }

        const castMatch = value.match(/^(%(.+)%)\s*([LD])$/i);
        if (castMatch) {
            p.next();
            validateNumericalPlaceholder(p, castMatch[2], token.span);
            return `"${value}"`;
        }

        // The string isn't numeric, isn't a `%var%L`/`%var%D` cast, and below
        // we'd fall through to `parseNumericalPlaceholder`, which would emit
        // the misleading "Expected placeholder" error. Bail out here with a
        // clearer message unless the string is actually placeholder-shaped.
        if (!value.startsWith("%")) {
            throw Diagnostic.error("Expected number or numeric placeholder")
                .addPrimarySpan(token.span, `\`"${value}"\` is not a number`);
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

    throw Diagnostic.error("Expected value")
        .addPrimarySpan(p.token.span);
}

// A bare placeholder value is one balanced `%...%` group, but its fallback may
// itself be a placeholder: `%var.player/g %var.player/k%%` is the normalized
// form of the `var g %var.player/k%` shorthand, and it is what the printer
// emits. The lexer knows nothing of nesting and fragments such a value at the
// inner `%`s, so rebuild it from the raw source: take the longest balanced
// group that is followed by whitespace or the end of the line, and advance
// past every token it covers.
const BALANCED_PLACEHOLDER = /^%[^%"\n]*(?:(?:%[^%\n]*%|"(?:[^"\\\n]|\\.)*")[^%"\n]*)*%/;

function parseBarePlaceholderValue(p: Parser): Value {
    const startSpan = p.token.span;
    const src = p.lexer.src;
    const from = startSpan.start - p.lexer.posOffset;
    let lineEnd = src.indexOf("\n", from);
    if (lineEnd === -1) lineEnd = src.length;
    const raw = src.slice(from, lineEnd);

    const matched = raw.match(BALANCED_PLACEHOLDER)?.[0];
    const after = matched !== undefined ? raw.charAt(matched.length) : "";
    if (matched !== undefined && (after === "" || /\s/.test(after))) {
        const end = startSpan.start + matched.length;
        while (p.token.kind !== "eof" && p.token.kind !== "eol" && p.token.span.start < end) {
            p.next();
        }
        return matched;
    }

    p.eat("placeholder");
    return `%${(p.prev as PlaceholderKind).value}%`;
}

export function parseValue(p: Parser): Value {
    if (p.check("str")) {
        const value = p.parseString();
        if (value.length > 32) {
            p.gcx.addDiagnostic(Diagnostic.error("Value exceeds 32-character limit")
                .addPrimarySpan(p.prev.span, `${value.length} characters`));
        }
        return `"${value}"`;
    }

    const start = p.token.span;
    let value: Value;
    if (p.check("placeholder")) {
        value = parseBarePlaceholderValue(p);
    } else {
        value = parseNumericValue(p);
    }

    // The in-game value input rejects anything longer than 32 characters, and
    // the cap applies to the raw text that gets typed with placeholder syntax
    // included. A shorthand with a quoted fallback (`var k "<template>"`
    // becomes `%var.player/k "<template>"%`) silently exceeds it otherwise.
    const typed = value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1)
        : value;
    if (typed.length > 32) {
        p.gcx.addDiagnostic(Diagnostic.error("Value exceeds 32-character limit")
            .addPrimarySpan(start.to(p.prev.span), `${typed.length} characters`));
    }
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

function parseCoordinates(p: Parser): { value: string, coordinates: Coordinates } {
    if (p.token.kind !== "str") {
        throw Diagnostic.error("Expected coordinates")
            .addPrimarySpan(p.token.span);
    }

    const value = p.token.value;
    const span = p.token.span;
    p.next();

    const file = new SourceFile("DUMMYSTRING_YOU.KNOW.WHERE.TO.FIND.ME_REPLACE+LATER+WITH+A+PROPER+DUMMY+SOURCE+FILE+IMPLEMENTATION+MAYBE?", value);
    file.startPos = span.start + 1;

    const lexer = new Lexer(file);
    const sp = new Parser(p.gcx, lexer);

    const coordinates = parseCoordinates0(sp);
    return { value, coordinates };
}

function parseCoordinates0(sp: Parser): Coordinates {
    const start = sp.token.span.start;
    
    const { value: x, span: xSpan } = sp.spanned(parseCoordinate);
    const { value: y, span: ySpan } = sp.spanned(parseCoordinate);
    const { value: z, span: zSpan } = sp.spanned(parseCoordinate);

    const coords = [x, y, z];

    const localCoord = coords.find(it => it.kind === "local");
    const nonLocalCoord = coords.find(it => it.kind !== "local");

    if (localCoord && nonLocalCoord) {
        const err = Diagnostic.error("Cannot mix local and non-local coordinates")
            .addSecondarySpan(sp.gcx.spans.get(localCoord), "Local coordinate used here")
            .addPrimarySpan(sp.gcx.spans.get(nonLocalCoord), "Non-local coordinate");
    
        sp.gcx.addDiagnostic(err);
    }

    const coordinates: Coordinates = {
        x, y, z, pitch: undefined, yaw: undefined
    };

    sp.gcx.spans.setField(coordinates, "x", xSpan);
    sp.gcx.spans.setField(coordinates, "y", ySpan);
    sp.gcx.spans.setField(coordinates, "z", zSpan);
    
    if (sp.check("eof")) {
        // 3 coordinate location
        const end = sp.prev.span.end;
        sp.gcx.spans.set(coordinates, new Span(start, end));
        return coordinates;
    }
    
    const { value: yaw, span: yawSpan } = sp.spanned(parseNumericCoordinateValue);
    coordinates.yaw = yaw;
    sp.gcx.spans.setField(coordinates, "yaw", yawSpan);
    
    if (sp.check("eof")) {
        // 4 coordinate location
        const end = sp.prev.span.end;
        sp.gcx.spans.set(coordinates, new Span(start, end));
        return coordinates;
    }

    // 5 coordinate location
    const { value: pitch, span: pitchSpan } = sp.spanned(parseNumericCoordinateValue);
    coordinates.pitch = pitch;
    sp.gcx.spans.setField(coordinates, "pitch", pitchSpan);
    
    if (!sp.check("eof")) {
        sp.gcx.addDiagnostic(Diagnostic.error("Custom coordinates can have at most 5 components")
            .addPrimarySpan(sp.token.span));
    }

    const end = sp.prev.span.end;
    sp.gcx.spans.set(coordinates, new Span(start, end));
    return coordinates;
}

function parseCoordinate(sp: Parser): Coordinate {
    const start = sp.token.span.start;

    const { value: kind, span: kindSpan } = sp.spanned(parseCoordinateKind);

    // This is terrible and I hate this forever and ever
    let value: Value;
    let valueSpan: Span;

    // This is hacky magic scary bullshit
    if (kind !== "absolute" && (kindSpan.end !== sp.token.span.start || sp.token.kind === "eof")) {
        value = "0";
        valueSpan = Span.at(kindSpan.end);
    } else {
        const spanned = sp.spanned(parseNumericCoordinateValue);
        value = spanned.value;
        valueSpan = spanned.span;
    }
    
    const end = sp.prev.span.end;

    const coordinate: Coordinate = { kind, value };
    sp.gcx.spans.set(coordinate, new Span(start, end));
    sp.gcx.spans.setField(coordinate, "kind", kindSpan);
    sp.gcx.spans.setField(coordinate, "value", valueSpan);
    return coordinate;
}

function parseCoordinateKind(sp: Parser): Coordinate["kind"] {
    if (sp.eat("tilde")) return "relative";
    if (sp.eat({ kind: "bin_op", op: "caret" })) return "local";
    return "absolute";
}

function parseNumericCoordinateValue(sp: Parser): Value {
    const { value, span } = sp.spanned(parseNumericValue);

    if (value.includes(" ")) {
        const err = Diagnostic.error("Invalid value")
            .addPrimarySpan(span)
            .addSubDiagnostic(Diagnostic.note(
                "Placeholders with spaces do not work as coordinate components"
            ));
        
        sp.gcx.addDiagnostic(err);
    }

    return value;
}
