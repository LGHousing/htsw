import { Diagnostic, Span } from "htsw";
import type {
    Condition,
    ConditionCompareHealth,
    ConditionCompareHunger,
    ConditionCompareMaxHealth,
    ConditionComparePlaceholder,
    ConditionCompareVar,
    ConditionRequireGamemode,
    ConditionRequireItem,
    ConditionRequirePotionEffect,
} from "htsw/types";

import { parseValue, VarHolder, VarLong } from "./vars";
import { parsePlaceholder } from "./placeholders";
import { Simulator } from "./simulator";
import { getGamemode } from "./helpers";
import { printDiagnostic } from "../tui/diagnostics";

function typeSpan(condition: object): Span {
    return Simulator.getFieldSpan(condition, "type")
        ?? Simulator.getNodeSpan(condition)
        ?? Span.dummy();
}

export function runCondition(condition: Condition): boolean {
    if (condition.type === "COMPARE_HEALTH") {
        return runConditionCompareHealth(condition);
    } else if (condition.type === "COMPARE_HUNGER") {
        return runConditionCompareHunger(condition);
    } else if (condition.type === "COMPARE_MAX_HEALTH") {
        return runConditionCompareMaxHealth(condition);
    } else if (condition.type === "COMPARE_PLACEHOLDER") {
        return runConditionComparePlaceholder(condition);
    } else if (condition.type === "COMPARE_VAR") {
        return runConditionCompareVar(condition);
    } else if (condition.type === "IS_FLYING") {
        return Player.isFlying();
    } else if (condition.type === "IS_SNEAKING") {
        return Player.isSneaking();
    } else if (condition.type === "REQUIRE_GAMEMODE") {
        return runConditionRequireGamemode(condition);
    } else if (condition.type === "REQUIRE_ITEM") {
        return runConditionRequireItem(condition);
    } else if (condition.type === "REQUIRE_POTION_EFFECT") {
        return runConditionRequirePotionEffect(condition);
    }

    const warn = Diagnostic.warning("Condition cannot be run in Simulator mode")
        .addPrimarySpan(typeSpan(condition as object));

    printDiagnostic(Simulator.sm, warn);

    return false;
}

function runConditionCompareHealth(
    condition: ConditionCompareHealth
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(Player.getHP());
    const rhs = parseValue(condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function runConditionCompareHunger(
    condition: ConditionCompareHunger
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(Player.getHunger());
    const rhs = parseValue(condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function runConditionCompareMaxHealth(
    condition: ConditionCompareMaxHealth
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(
        Player.getPlayer()
            .func_110138_aP /*getMaxHealth*/
            ()
    );
    const rhs = parseValue(condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function runConditionComparePlaceholder(
    condition: ConditionComparePlaceholder
): boolean {
    if (!condition.placeholder || !condition.op || !condition.amount) return false;

    const lhs = parsePlaceholder(condition.placeholder);
    const rhs = parseValue(condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function runConditionCompareVar(
    condition: ConditionCompareVar
): boolean {
    if (!condition.holder || !condition.var || !condition.op || !condition.amount)
        return false;

    const holderType = condition.holder.type;

    const varKey =
        holderType === "team"
            ? { team: condition.holder.team, key: condition.var }
            : condition.var;

    const varHolder: VarHolder<any> =
        holderType === "team"
            ? Simulator.teamVars
            : holderType === "global"
              ? Simulator.globalVars
              : Simulator.playerVars;

    const fallback = condition.fallback
        ? parseValue(condition.fallback)
        : undefined;

    const lhs = varHolder.getVar(varKey, fallback);
    const rhs = parseValue(condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function runConditionRequireGamemode(
    condition: ConditionRequireGamemode
): boolean {
    if (!condition.gamemode) return false;

    return getGamemode() == condition.gamemode;
}

function runConditionRequireItem(
    condition: ConditionRequireItem
): boolean {
    if (
        !condition.item ||
        !condition.whatToCheck ||
        !condition.whereToCheck ||
        !condition.amount
    )
        return false;

    return false; // TODO: items!
}

function runConditionRequirePotionEffect(
    condition: ConditionRequirePotionEffect
): boolean {
    if (!condition.effect) return false;

    return (
        Player.getActivePotionEffects().find((effect) => {
            return effect.getLocalizedName() == condition.effect!;
        }) !== undefined
    );
}
