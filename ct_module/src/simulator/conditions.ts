import * as htsl from "htsl";

import { parseValue, VarHolder, VarLong } from "./vars";
import { parsePlaceholder } from "./placeholders";
import { Simulator } from "./simulator";
import { getGamemode } from "./helpers";
import { printDiagnostic } from "../compiler/diagnostics";

export function runCondition(condition: htsl.Ir<htsl.Condition>): boolean {
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

    const warn = htsl.warn("Condition cannot be run in Simulator mode", condition.kwSpan);
    printDiagnostic(Simulator.sm, warn);

    return false;
}

function runConditionCompareHealth(
    condition: htsl.Ir<htsl.ConditionCompareHealth>
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(Player.getHP());
    const rhs = parseValue(condition.amount.value);

    return lhs.cmpOp(rhs, condition.op.value);
}

function runConditionCompareHunger(
    condition: htsl.Ir<htsl.ConditionCompareHunger>
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(Player.getHunger());
    const rhs = parseValue(condition.amount.value);

    return lhs.cmpOp(rhs, condition.op.value);
}

function runConditionCompareMaxHealth(
    condition: htsl.Ir<htsl.ConditionCompareMaxHealth>
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = VarLong.fromNumber(
        Player.getPlayer()
            .func_110138_aP /*getMaxHealth*/
            ()
    );
    const rhs = parseValue(condition.amount.value);

    return lhs.cmpOp(rhs, condition.op.value);
}

function runConditionComparePlaceholder(
    condition: htsl.Ir<htsl.ConditionComparePlaceholder>
): boolean {
    if (!condition.placeholder || !condition.op || !condition.amount) return false;

    const lhs = parsePlaceholder(condition.placeholder.value);
    const rhs = parseValue(condition.amount.value);

    return lhs.cmpOp(rhs, condition.op.value);
}

function runConditionCompareVar(
    condition: htsl.Ir<htsl.ConditionCompareVar>
): boolean {
    if (!condition.holder || !condition.var || !condition.op || !condition.amount)
        return false;

    const holderType = condition.holder.value.type;

    const varKey =
        holderType === "team"
            ? { team: condition.holder.value.team, key: condition.var.value }
            : condition.var.value;

    const varHolder: VarHolder<any> =
        holderType === "team"
            ? Simulator.teamVars
            : holderType === "global"
              ? Simulator.globalVars
              : Simulator.playerVars;

    const fallback = condition.fallback
        ? parseValue(condition.fallback.value)
        : undefined;

    const lhs = varHolder.getVar(varKey, fallback);
    const rhs = parseValue(condition.amount.value);

    return lhs.cmpOp(rhs, condition.op.value);
}

function runConditionRequireGamemode(
    condition: htsl.Ir<htsl.ConditionRequireGamemode>
): boolean {
    if (!condition.gamemode) return false;

    return getGamemode() == condition.gamemode.value;
}

function runConditionRequireItem(
    condition: htsl.Ir<htsl.ConditionRequireItem>
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
    condition: htsl.Ir<htsl.ConditionRequirePotionEffect>
): boolean {
    if (!condition.effect) return false;

    return (
        Player.getActivePotionEffects().find((effect) => {
            return effect.getLocalizedName() == condition.effect!.value;
        }) !== undefined
    );
}
