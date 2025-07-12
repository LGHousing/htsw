import type { Parser } from './parser';
import type { IrCondition } from '../ir';
import { error } from '../diagnostic';
import { Span } from '../span';
import {
    parseNumericValue,
    parseComparison,
    parseGamemode,
    parseItemLocation,
    parseItemProperty,
    parsePermission,
    parsePotionEffect,
    parseVarName, parseValue,
} from './arguments';
import { parseNumericalPlaceholder } from './placeholders';
import type { ConditionKw } from '../helpers';
import type { VarHolder } from 'housing-common';

type Inverted = { value: boolean; span: Span };

export function parseCondition(p: Parser): IrCondition {
    function eatKw(kw: ConditionKw): boolean {
        return p.eatIdent(kw);
    }
    const inverted = p.spanned(() => p.eat('exclamation'));

    if (eatKw('hasGroup')) {
        return parseConditionRequireGroup(p, inverted);
    } else if (eatKw('stat')) {
        return parseConditionCompareVar(p, inverted);
    } else if (eatKw('globalstat')) {
        return parseConditionCompareGlobalVar(p, inverted);
    } else if (eatKw('hasPermission')) {
        return parseConditionRequirePermission(p, inverted);
    } else if (eatKw('inRegion')) {
        return parseConditionIsInRegion(p, inverted);
    } else if (eatKw('hasItem')) {
        return parseConditionRequireItem(p, inverted);
    } else if (eatKw('doingParkour')) {
        return {
            type: 'IS_DOING_PARKOUR',
            inverted,
            kwSpan: p.prev.span,
            span: p.prev.span,
        };
    } else if (eatKw('hasPotion')) {
        return parseConditionRequirePotionEffect(p, inverted);
    } else if (eatKw('isSneaking')) {
        return { type: 'IS_SNEAKING', inverted, kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('isFlying')) {
        return { type: 'IS_FLYING', inverted, kwSpan: p.prev.span, span: p.prev.span };
    } else if (eatKw('health')) {
        return parseConditionCompareHealth(p, inverted);
    } else if (eatKw('maxHealth')) {
        return parseConditionCompareMaxHealth(p, inverted);
    } else if (eatKw('hunger')) {
        return parseConditionCompareHunger(p, inverted);
    } else if (eatKw('gamemode')) {
        return parseConditionRequireGamemode(p, inverted);
    } else if (eatKw('placeholder')) {
        return parseConditionComparePlaceholder(p, inverted);
    } else if (eatKw('hasTeam')) {
        return parseConditionRequireTeam(p, inverted);
    } else if (eatKw('teamstat')) {
        return parseConditionCompareTeamStat(p, inverted);
    } else if (eatKw('damageAmount')) {
        return parseConditionCompareDamage(p, inverted);
    }

    if (p.check('ident')) {
        throw error('Unknown condition', p.token.span);
    } else {
        throw error('Expected condition', p.token.span);
    }
}

function parseConditionRecovering<T extends IrCondition['type']>(
    p: Parser,
    type: T,
    inverted: Inverted,
    parser: (condition: IrCondition & { type: T }) => void
): IrCondition & { type: T } {
    const start = p.prev.span.start;
    const condition = {
        type, inverted, kwSpan: p.prev.span,
        span: Span.single(-1) // placeholder
    } as IrCondition & { type: T };

    p.parseRecovering(['comma', { kind: 'close_delim', delim: 'parenthesis' }], () => {
        parser(condition);
    });
    condition.span = new Span(start, p.prev.span.end);
    return condition;
}

function checkEnd(p: Parser): boolean {
    return p.check('comma') || p.check({ kind: 'close_delim', delim: 'parenthesis' });
}

function parseConditionRequireGroup(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_GROUP', inverted, (condition) => {
        condition.group = p.spanned(p.parseName);
        if (checkEnd(p)) return;
        condition.includeHigherGroups = p.spanned(p.parseBoolean);
    });
}

function parseConditionCompareVar(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_VAR', inverted, (condition) => {
        condition.holder = p.spanned(() => ({ type: 'player' }) as VarHolder);
        condition.var = p.spanned(parseVarName);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionCompareGlobalVar(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_VAR', inverted, (condition) => {
        condition.holder = p.spanned(() => ({ type: 'global' }) as VarHolder);
        condition.var = p.spanned(parseVarName);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionRequirePermission(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_PERMISSION', inverted, (condition) => {
        condition.permission = p.spanned(parsePermission);
    });
}

function parseConditionIsInRegion(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'IS_IN_REGION', inverted, (condition) => {
        condition.region = p.spanned(p.parseName);
    });
}

function parseConditionRequireItem(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_ITEM', inverted, (condition) => {
        condition.item = p.spanned(p.parseName);
        condition.whatToCheck = p.spanned(parseItemProperty);
        condition.whereToCheck = p.spanned(parseItemLocation);
        condition.amount = p.spanned(() => {
            if (p.eatOption('Any Amount') || p.eatOption('anyAmount'))
                return 'Any Amount';
            else if (
                p.eatOption('Equal or Greater Amount') ||
                p.eatOption('equalOrGreaterAmount')
            ) {
                return 'Equal or Greater Amount';
            } else throw error('Expected item amount', p.token.span);
        });
    });
}

function parseConditionRequirePotionEffect(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_POTION_EFFECT', inverted, (condition) => {
        condition.effect = p.spanned(parsePotionEffect);
    });
}

function parseConditionCompareHealth(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_HEALTH', inverted, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionCompareMaxHealth(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_MAX_HEALTH', inverted, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionCompareHunger(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_HUNGER', inverted, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionRequireGamemode(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_GAMEMODE', inverted, (condition) => {
        condition.gamemode = p.spanned(parseGamemode);
    });
}

function parseConditionComparePlaceholder(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_PLACEHOLDER', inverted, (condition) => {
        condition.placeholder = p.spanned(parseNumericalPlaceholder);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}

function parseConditionRequireTeam(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'REQUIRE_TEAM', inverted, (condition) => {
        condition.team = p.spanned(p.parseName);
    });
}

function parseConditionCompareTeamStat(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_VAR', inverted, (condition) => {
        condition.var = p.spanned(parseVarName);
        condition.holder = p.spanned(() => ({ type: 'team', team: p.parseName() }) as VarHolder);
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseValue);
        if (checkEnd(p)) return; // shorthand
        condition.fallback = p.spanned(parseValue);
    });
}

function parseConditionCompareDamage(p: Parser, inverted: Inverted): IrCondition {
    return parseConditionRecovering(p, 'COMPARE_DAMAGE', inverted, (condition) => {
        condition.op = p.spanned(parseComparison);
        condition.amount = p.spanned(parseNumericValue);
    });
}
