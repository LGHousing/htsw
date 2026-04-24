import type { Parser } from "./parser";
import { Diagnostic } from "../../diagnostic";
import { parseValue, parseVarName } from "./arguments";
import { Span } from "../../span";
import type { ShorthandKw } from "./helpers";
import { PLACEHOLDER_SPECS } from "../../types";

export function parseNumericalPlaceholder(p: Parser): string {
    function eatKw(kw: ShorthandKw): boolean {
        return p.eatIdent(kw);
    }

    if (eatKw("var") || eatKw("stat")) {
        const name = parseVarName(p);

        if (p.check("i64") || p.check("f64") || p.check("str")) {
            const fallback = parseValue(p);
            return `%var.player/${name} ${fallback}%`;
        } else {
            return `%var.player/${name}%`;
        }
    }
    if (eatKw("globalvar") || eatKw("globalstat")) {
        const name = parseVarName(p);

        if (p.check("i64") || p.check("f64") || p.check("str")) {
            const fallback = parseValue(p);
            return `%var.global/${name} ${fallback}%`;
        } else {
            return `%var.global/${name}%`;
        }
    }
    if (eatKw("teamvar") || eatKw("teamstat")) {
        const name = parseVarName(p);

        if (!p.check("ident") && !p.check("str")) {
            throw Diagnostic.error("Expected team name")
                .addPrimarySpan(p.token.span);
        }
        const team = parseVarName(p);

        if (p.check("i64") || p.check("f64") || p.check("str")) {
            const fallback = parseValue(p);
            return `%var.team/${name} ${team} ${fallback}%`;
        } else {
            return `%var.team/${name} ${team}%`;
        }
    }
    if (eatKw("randomint")) {
        const from = p.parseNumber();
        const to = p.parseNumber();
        return `%random.int/${from} ${to}%`;
    }

    if (eatKw("health")) return "%player.health%";
    if (eatKw("maxHealth")) return "%player.maxHealth%";
    if (eatKw("hunger")) return "%player.hunger%";
    if (eatKw("locX")) return "%player.location.x%";
    if (eatKw("locY")) return "%player.location.y%";
    if (eatKw("locZ")) return "%player.location.z%";
    if (eatKw("unix")) return "%date.unix%";

    if (p.token.kind !== "str" && p.token.kind !== "placeholder") {
        throw Diagnostic.error("Expected placeholder")
            .addPrimarySpan(p.token.span);
    }

    let value = p.token.value;
    const span = p.token.span;
    p.next();

    if (p.prev.kind === "str") {
        if (!(value.startsWith("%") && value.endsWith("%"))) {
            p.gcx.addDiagnostic(Diagnostic.error("Expected placeholder")
                .addPrimarySpan(p.prev.span));
            return "";
        }

        value = value.substring(1, value.length - 1);
    }

    return validateNumericalPlaceholder(p, value, span);
}

export function validateNumericalPlaceholder(
    p: Parser,
    value: string,
    span: Span,
): string {
    const index = value.indexOf("/");
    const name = value.substring(0, index == -1 ? value.length : index).toLowerCase();
    const args = index == -1 ? [] : value.substring(index + 1).split(" ");

    function addIssueInvalidPlaceholder() {
        p.gcx.addDiagnostic(Diagnostic.error("Invalid placeholder")
            .addPrimarySpan(span));
    }

    function addIssueInvalidArgument(message: string) {
        const lo = index == -1 ? value.length - 1 : index + 1;
        p.gcx.addDiagnostic(Diagnostic.error(message)
            .addPrimarySpan(new Span(span.start + lo, span.end)));
    }

    const spec = PLACEHOLDER_SPECS.find((placeholder) => placeholder.name === name);
    if (spec?.args === "none") {
        if (args.length > 0) addIssueInvalidArgument("No arguments expected");
        if (spec.valueType !== "number") addIssueInvalidPlaceholder();
        return `%${value}%`;
    }

    switch (name) {
        case "var.player":
        case "var.global":
            if (args.length == 0) addIssueInvalidArgument("Expected stat key");
            break;
        case "var.team":
            if (args.length == 0) addIssueInvalidArgument("Expected stat key");
            if (args.length == 1) addIssueInvalidArgument("Expected team name");
            if (args.length > 2)
                addIssueInvalidArgument("Team stat key cannot contain spaces");
            break;
        case "random.int":
        case "random.whole":
            if (args.length == 0) addIssueInvalidArgument("Expected lower bound");
            else if (args.length == 1) addIssueInvalidArgument("Expected upper bound");
            else if (args.length > 2) addIssueInvalidArgument("Unknown argument");
            else if (!/^-?\d+$/.test(args[0]) || !/^-?\d+$/.test(args[1]))
                addIssueInvalidArgument("Bounds must be integers");
            break;
        case "random.decimal":
            if (args.length == 0) addIssueInvalidArgument("Expected lower bound");
            else if (args.length == 1) addIssueInvalidArgument("Expected upper bound");
            else if (args.length > 2) addIssueInvalidArgument("Unknown argument");
            else if (isNaN(Number(args[0])) || isNaN(Number(args[1])))
                addIssueInvalidArgument("Bounds must be numbers");
            break;
        default:
            addIssueInvalidPlaceholder();
    }

    return `%${value}%`;
}
