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
import { getPlayer } from "../utils/java";

export function createConditionBehaviors(vars: runtime.simple.Vars): runtime.ConditionBehaviors {
    return new runtime.simple.SimpleConditionBehaviors(vars)
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
        getPlayer()
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
    _condition: ConditionRequireItem
): boolean {
    // Item-inventory checks aren't simulated yet, so the condition never holds.
    return false;
}

function behaviorRequirePotionEffect(
    _rt: runtime.Runtime,
    condition: ConditionRequirePotionEffect
): boolean {
    const expectedEffect = condition.effect;
    if (!expectedEffect) return false;

    return (
        Player.getActivePotionEffects().find((effect) => {
            return effect.getLocalizedName() == expectedEffect;
        }) !== undefined
    );
}
