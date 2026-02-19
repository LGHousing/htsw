import type { Parser } from "./parser";
import type { IrCondition, Spanned } from "../../ir";
import { Diagnostic } from "../../diagnostic";
import { Span } from "../../span";
import {
    parseNumericValue,
    parseComparison,
    parseGamemode,
    parseItemLocation,
    parseItemProperty,
    parsePermission,
    parsePotionEffect,
    parseVarName,
    parseValue,
    parseItemAmount,
} from "./arguments";
import { parseNumericalPlaceholder } from "./placeholders";
import { withDummyTypeSpans, type ConditionKw } from "./helpers";

type Inverted = Spanned<boolean>;
type Note = Spanned<string> | undefined;

export function parseCondition(p: Parser): IrCondition {
    function eatKw(kw: ConditionKw): boolean {
        return p.eatIdent(kw);
    }

    let note: Note;
    if (p.check("doc_comment")) {
        note = p.spanned(p.parseDocComment);
        p.eat("eol");
    }

    const inverted = p.spanned(() => p.eat("exclamation"));

    if (eatKw("hasGroup")) {
        return parseConditionRequireGroup(p, inverted, note);
    } else if (eatKw("var") || eatKw("stat")) {
        return parseConditionCompareVar(p, inverted, note);
    } else if (eatKw("globalvar") || eatKw("globalstat")) {
        return parseConditionCompareGlobalVar(p, inverted, note);
    } else if (eatKw("hasPermission")) {
        return parseConditionRequirePermission(p, inverted, note);
    } else if (eatKw("inRegion")) {
        return parseConditionIsInRegion(p, inverted, note);
    } else if (eatKw("hasItem")) {
        return parseConditionRequireItem(p, inverted, note);
    } else if (eatKw("doingParkour")) {
        return {
            type: "IS_DOING_PARKOUR",
            typeSpan: p.prev.span,
            span: p.prev.span,
            inverted,
            note,
        };
    } else if (eatKw("hasPotion")) {
        return parseConditionRequirePotionEffect(p, inverted, note);
    } else if (eatKw("isSneaking")) {
        return {
            type: "IS_SNEAKING",
            typeSpan: p.prev.span,
            span: p.prev.span,
            inverted,
            note,
        };
    } else if (eatKw("isFlying")) {
        return { type: "IS_FLYING", inverted, typeSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw("health")) {
        return parseConditionCompareHealth(p, inverted, note);
    } else if (eatKw("maxHealth")) {
        return parseConditionCompareMaxHealth(p, inverted, note);
    } else if (eatKw("hunger")) {
        return parseConditionCompareHunger(p, inverted, note);
    } else if (eatKw("gamemode")) {
        return parseConditionRequireGamemode(p, inverted, note);
    } else if (eatKw("placeholder")) {
        return parseConditionComparePlaceholder(p, inverted, note);
    } else if (eatKw("hasTeam")) {
        return parseConditionRequireTeam(p, inverted, note);
    } else if (eatKw("teamvar") || eatKw("teamstat")) {
        return parseConditionCompareTeamVar(p, inverted, note);
    } else if (eatKw("damageAmount")) {
        return parseConditionCompareDamage(p, inverted, note);
    }

    if (p.check("ident")) {
        throw Diagnostic.error("Unknown condition").addPrimarySpan(p.token.span);
    } else {
        throw Diagnostic.error("Expected condition").addPrimarySpan(p.token.span);
    }
}

function parseConditionRecovering<T extends IrCondition["type"]>(
    p: Parser,
    type: T,
    inverted: Inverted,
    note: Note,
    parser: (condition: IrCondition & { type: T }) => void
): IrCondition & { type: T } {
    const start = p.prev.span.start;
    const condition = {
        type,
        typeSpan: p.prev.span,
        span: Span.dummy(), // placeholder
        inverted,
        note,
    } as Extract<IrCondition, { type: T }>;

    p.parseRecovering(["comma", { kind: "close_delim", delim: "parenthesis" }], () => {
        parser(condition);
    });
    condition.span = new Span(start, p.prev.span.end);
    return condition;
}

function checkEnd(p: Parser): boolean {
    return p.check("comma") || p.check({ kind: "close_delim", delim: "parenthesis" });
}

function parseConditionRequireGroup(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "REQUIRE_GROUP", inverted, note, (condition) => {
        condition.group = p.spanned(p.parseName);
        if (checkEnd(p)) return;
        condition.includeHigherGroups = p.spanned(p.parseBoolean);
    });
}

function parseConditionCompareVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        condition.holder = p.spanned(() =>
            withDummyTypeSpans({ type: "player" } as const)
        );
        condition.var = p.spanned(parseVarName);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionCompareGlobalVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        condition.holder = p.spanned(() =>
            withDummyTypeSpans({ type: "global" } as const)
        );
        condition.var = p.spanned(parseVarName);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionRequirePermission(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(
        p,
        "REQUIRE_PERMISSION",
        inverted,
        note,
        (condition) => {
            condition.permission = p.spanned(parsePermission);
        }
    );
}

function parseConditionIsInRegion(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "IS_IN_REGION", inverted, note, (condition) => {
        condition.region = p.spanned(p.parseName);
    });
}

function parseConditionRequireItem(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "REQUIRE_ITEM", inverted, note, (condition) => {
        condition.item = p.spanned(p.parseName);
        condition.whatToCheck = p.spanned(parseItemProperty);
        condition.whereToCheck = p.spanned(parseItemLocation);
        condition.amount = p.spanned(parseItemAmount);
    });
}

function parseConditionRequirePotionEffect(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(
        p,
        "REQUIRE_POTION_EFFECT",
        inverted,
        note,
        (condition) => {
            condition.effect = p.spanned(parsePotionEffect);
        }
    );
}

function parseConditionCompareHealth(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_HEALTH", inverted, note, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionCompareMaxHealth(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(
        p,
        "COMPARE_MAX_HEALTH",
        inverted,
        note,
        (condition) => {
            condition.op = p.spanned(parseComparison);
            condition.amount = p.spanned(parseNumericValue);
        }
    );
}

function parseConditionCompareHunger(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_HUNGER", inverted, note, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionRequireGamemode(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(
        p,
        "REQUIRE_GAMEMODE",
        inverted,
        note,
        (condition) => {
            condition.gamemode = p.spanned(parseGamemode);
        }
    );
}

function parseConditionComparePlaceholder(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(
        p,
        "COMPARE_PLACEHOLDER",
        inverted,
        note,
        (condition) => {
            condition.placeholder = p.spanned(parseNumericalPlaceholder);
            condition.op = p.spanned(parseComparison);
            condition.amount = p.spanned(parseNumericValue);
        }
    );
}

function parseConditionRequireTeam(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "REQUIRE_TEAM", inverted, note, (condition) => {
        condition.team = p.spanned(p.parseName);
    });
}

function parseConditionCompareTeamVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        condition.var = p.spanned(parseVarName);
        condition.holder = p.spanned(() =>
            withDummyTypeSpans({ type: "team", team: p.spanned(p.parseName) } as const)
        );
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionCompareDamage(
    p: Parser,
    inverted: Inverted,
    note: Note
): IrCondition {
    return parseConditionRecovering(p, "COMPARE_DAMAGE", inverted, note, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}
