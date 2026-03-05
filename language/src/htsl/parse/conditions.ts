import type { Parser } from "./parser";
import type { Condition } from "../../types";
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
import { type ConditionKw } from "./helpers";

type Inverted = { value: boolean; span: Span };
type Note = { value: string; span: Span } | undefined;

function setField<T extends object, K extends keyof T>(
    p: Parser,
    node: T,
    key: K,
    parser: ((p: Parser) => T[K]) | (() => T[K]),
): T[K] {
    const { value, span } = p.spanned(parser as any) as { value: T[K]; span: Span };
    node[key] = value;
    p.gcx.spans.setField(node, key, span);
    return value;
}

function setFieldWithSpan<T extends object, K extends keyof T>(
    p: Parser,
    node: T,
    key: K,
    value: T[K],
    span: Span,
) {
    node[key] = value;
    p.gcx.spans.setField(node, key, span);
}

function setNodeSpan(p: Parser, node: object, span: Span) {
    p.gcx.spans.set(node, span);
}

function setConditionMeta<T extends { inverted?: boolean; note?: string }>(
    p: Parser,
    condition: T,
    inverted: Inverted,
    note: Note,
) {
    if (inverted.value) {
        setFieldWithSpan(p, condition, "inverted", true, inverted.span);
    }
    if (note) {
        setFieldWithSpan(p, condition, "note", note.value, note.span);
    }
}

export function parseCondition(p: Parser): Condition {
    function eatKw(kw: ConditionKw): boolean {
        return p.eatIdent(kw);
    }

    let note: Note;
    if (p.check("doc_comment")) {
        note = p.spanned(p.parseDocComment);
        p.eat("eol");
    }

    const inverted: Inverted = p.spanned(() => p.eat("exclamation"));

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
        return parseSimpleCondition(p, "IS_DOING_PARKOUR", inverted, note);
    } else if (eatKw("hasPotion")) {
        return parseConditionRequirePotionEffect(p, inverted, note);
    } else if (eatKw("isSneaking")) {
        return parseSimpleCondition(p, "IS_SNEAKING", inverted, note);
    } else if (eatKw("isFlying")) {
        return parseSimpleCondition(p, "IS_FLYING", inverted, note);
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

function parseSimpleCondition<T extends Condition["type"]>(
    p: Parser,
    type: T,
    inverted: Inverted,
    note: Note,
): Extract<Condition, { type: T }> {
    const condition = { type } as Extract<Condition, { type: T }>;
    const typeSpan = p.prev.span;
    p.gcx.spans.setField(condition, "type", typeSpan);
    setConditionMeta(p, condition, inverted, note);
    setNodeSpan(p, condition, typeSpan);
    return condition;
}

function parseConditionRecovering<T extends Condition["type"]>(
    p: Parser,
    type: T,
    inverted: Inverted,
    note: Note,
    parser: (condition: Extract<Condition, { type: T }>) => void
): Extract<Condition, { type: T }> {
    const start = p.prev.span.start;
    const typeSpan = p.prev.span;
    const condition = { type } as Extract<Condition, { type: T }>;
    p.gcx.spans.setField(condition, "type", typeSpan);
    setConditionMeta(p, condition, inverted, note);

    p.parseRecovering(["comma", { kind: "close_delim", delim: "parenthesis" }], () => {
        parser(condition);
    });
    setNodeSpan(p, condition, new Span(start, p.prev.span.end));
    return condition;
}

function checkEnd(p: Parser): boolean {
    return p.check("comma") || p.check({ kind: "close_delim", delim: "parenthesis" });
}

function parseConditionRequireGroup(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "REQUIRE_GROUP", inverted, note, (condition) => {
        setField(p, condition, "group", p.parseName);
        if (checkEnd(p)) return;
        setField(p, condition, "includeHigherGroups", p.parseBoolean);
    });
}

function parseConditionCompareVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        setFieldWithSpan(p, condition, "holder", { type: "player" }, p.prev.span);
        setField(p, condition, "var", parseVarName);
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseValue);
        if (checkEnd(p)) return;
        setField(p, condition, "fallback", parseValue);
    });
}

function parseConditionCompareGlobalVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        setFieldWithSpan(p, condition, "holder", { type: "global" }, p.prev.span);
        setField(p, condition, "var", parseVarName);
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseValue);
        if (checkEnd(p)) return;
        setField(p, condition, "fallback", parseValue);
    });
}

function parseConditionRequirePermission(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(
        p,
        "REQUIRE_PERMISSION",
        inverted,
        note,
        (condition) => {
            setField(p, condition, "permission", parsePermission);
        }
    );
}

function parseConditionIsInRegion(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "IS_IN_REGION", inverted, note, (condition) => {
        setField(p, condition, "region", p.parseName);
    });
}

function parseConditionRequireItem(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "REQUIRE_ITEM", inverted, note, (condition) => {
        setField(p, condition, "item", p.parseName);
        setField(p, condition, "whatToCheck", parseItemProperty);
        setField(p, condition, "whereToCheck", parseItemLocation);
        setField(p, condition, "amount", parseItemAmount);
    });
}

function parseConditionRequirePotionEffect(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(
        p,
        "REQUIRE_POTION_EFFECT",
        inverted,
        note,
        (condition) => {
            setField(p, condition, "effect", parsePotionEffect);
        }
    );
}

function parseConditionCompareHealth(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_HEALTH", inverted, note, (condition) => {
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseNumericValue);
    });
}

function parseConditionCompareMaxHealth(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(
        p,
        "COMPARE_MAX_HEALTH",
        inverted,
        note,
        (condition) => {
            setField(p, condition, "op", parseComparison);
            setField(p, condition, "amount", parseNumericValue);
        }
    );
}

function parseConditionCompareHunger(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_HUNGER", inverted, note, (condition) => {
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseNumericValue);
    });
}

function parseConditionRequireGamemode(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(
        p,
        "REQUIRE_GAMEMODE",
        inverted,
        note,
        (condition) => {
            setField(p, condition, "gamemode", parseGamemode);
        }
    );
}

function parseConditionComparePlaceholder(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(
        p,
        "COMPARE_PLACEHOLDER",
        inverted,
        note,
        (condition) => {
            setField(p, condition, "placeholder", parseNumericalPlaceholder);
            setField(p, condition, "op", parseComparison);
            setField(p, condition, "amount", parseNumericValue);
        }
    );
}

function parseConditionRequireTeam(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "REQUIRE_TEAM", inverted, note, (condition) => {
        setField(p, condition, "team", p.parseName);
    });
}

function parseConditionCompareTeamVar(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_VAR", inverted, note, (condition) => {
        setField(p, condition, "var", parseVarName);
        const teamSpan = p.token.span;
        const team = p.parseName();
        const holder = { type: "team", team } as const;
        setFieldWithSpan(p, condition, "holder", holder, teamSpan.to(p.prev.span));
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseValue);
        if (checkEnd(p)) return;
        setField(p, condition, "fallback", parseValue);
    });
}

function parseConditionCompareDamage(
    p: Parser,
    inverted: Inverted,
    note: Note
): Condition {
    return parseConditionRecovering(p, "COMPARE_DAMAGE", inverted, note, (condition) => {
        setField(p, condition, "op", parseComparison);
        setField(p, condition, "amount", parseNumericValue);
    });
}
