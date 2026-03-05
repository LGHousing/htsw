import { runtime } from "htsw";
import type {
    ConditionCompareHealth,
    ConditionCompareHunger,
    ConditionCompareMaxHealth,
    ConditionRequireGamemode,
    ConditionRequireItem,
    ConditionRequirePotionEffect,
} from "htsw/types";

import { getGamemode } from "./helpers";

export function createConditionBehaviors(): runtime.ConditionBehaviors {
    return runtime.ConditionBehaviors.default()
        .with("COMPARE_HEALTH", behaviorCompareHealth)
        .with("COMPARE_HUNGER", behaviorCompareHunger)
        .with("COMPARE_MAX_HEALTH", behaviorCompareMaxHealth)
        .with("IS_FLYING", () => Player.isFlying())
        .with("IS_SNEAKING", () => Player.isSneaking())
        .with("REQUIRE_GAMEMODE", behaviorRequireGamemode)
        .with("REQUIRE_ITEM", behaviorRequireItem)
        .with("REQUIRE_POTION_EFFECT", behaviorRequirePotionEffect);
}

function behaviorCompareHealth(
    rt: runtime.Runtime,
    condition: ConditionCompareHealth
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = runtime.VarLong.fromNumber(Player.getHP());
    const rhs = runtime.parseValue(rt, condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function behaviorCompareHunger(
    rt: runtime.Runtime,
    condition: ConditionCompareHunger
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = runtime.VarLong.fromNumber(Player.getHunger());
    const rhs = runtime.parseValue(rt, condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function behaviorCompareMaxHealth(
    rt: runtime.Runtime,
    condition: ConditionCompareMaxHealth
): boolean {
    if (!condition.op || !condition.amount) return false;

    const lhs = runtime.VarLong.fromNumber(
        Player.getPlayer()
            .func_110138_aP /*getMaxHealth*/
            ()
    );
    const rhs = runtime.parseValue(rt, condition.amount);

    return lhs.cmpOp(rhs, condition.op);
}

function behaviorRequireGamemode(
    _rt: runtime.Runtime,
    condition: ConditionRequireGamemode
): boolean {
    if (!condition.gamemode) return false;

    return getGamemode() == condition.gamemode;
}

function behaviorRequireItem(
    _rt: runtime.Runtime,
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

function behaviorRequirePotionEffect(
    _rt: runtime.Runtime,
    condition: ConditionRequirePotionEffect
): boolean {
    if (!condition.effect) return false;

    return (
        Player.getActivePotionEffects().find((effect) => {
            return effect.getLocalizedName() == condition.effect!;
        }) !== undefined
    );
}
