import type {
    Condition,
    ConditionCompareDamage,
    ConditionCompareHealth,
    ConditionCompareHunger,
    ConditionCompareMaxHealth,
    ConditionComparePlaceholder,
    ConditionCompareVar,
    ConditionIsDoingParkour,
    ConditionIsFlying,
    ConditionIsInRegion,
    ConditionIsSneaking,
    ConditionRequireGamemode,
    ConditionRequireGroup,
    ConditionRequireItem,
    ConditionRequirePermission,
    ConditionRequirePotionEffect,
    ConditionRequireTeam,
} from "htsw/types";

import TaskContext from "../tasks/context";

const CONDITION_DISPLAY_NAMES: Record<Condition["type"], string> = {
    REQUIRE_GROUP: "Required Group",
    COMPARE_VAR: "Variable Requirement",
    REQUIRE_PERMISSION: "Required Permission",
    IS_IN_REGION: "Within Region",
    REQUIRE_ITEM: "Has Item",
    IS_DOING_PARKOUR: "Doing Parkour",
    REQUIRE_POTION_EFFECT: "Has Potion Effect",
    IS_SNEAKING: "Player Sneaking",
    IS_FLYING: "Player Flying",
    COMPARE_HEALTH: "Player Health",
    COMPARE_MAX_HEALTH: "Max Player Health",
    COMPARE_HUNGER: "Player Hunger",
    REQUIRE_GAMEMODE: "Required Gamemode",
    COMPARE_PLACEHOLDER: "Placeholder Number Requirement",
    REQUIRE_TEAM: "Required Team",
    COMPARE_DAMAGE: "Damage Amount",
};

export async function importCondition(
    ctx: TaskContext,
    condition: Condition
): Promise<void> {
    switch (condition.type) {
        case "REQUIRE_GROUP":
            return importRequireGroup(ctx, condition);
        case "COMPARE_VAR":
            return importCompareVar(ctx, condition);
        case "REQUIRE_PERMISSION":
            return importRequirePermission(ctx, condition);
        case "IS_IN_REGION":
            return importIsInRegion(ctx, condition);
        case "REQUIRE_ITEM":
            return importRequireItem(ctx, condition);
        case "IS_DOING_PARKOUR":
            return importIsDoingParkour(ctx, condition);
        case "REQUIRE_POTION_EFFECT":
            return importRequirePotionEffect(ctx, condition);
        case "IS_SNEAKING":
            return importIsSneaking(ctx, condition);
        case "IS_FLYING":
            return importIsFlying(ctx, condition);
        case "COMPARE_HEALTH":
            return importCompareHealth(ctx, condition);
        case "COMPARE_MAX_HEALTH":
            return importCompareMaxHealth(ctx, condition);
        case "COMPARE_HUNGER":
            return importCompareHunger(ctx, condition);
        case "REQUIRE_GAMEMODE":
            return importRequireGamemode(ctx, condition);
        case "COMPARE_PLACEHOLDER":
            return importComparePlaceholder(ctx, condition);
        case "REQUIRE_TEAM":
            return importRequireTeam(ctx, condition);
        case "COMPARE_DAMAGE":
            return importCompareDamage(ctx, condition);
        default:
            const _exhaustiveCheck: never = condition;
    }
}

async function importRequireGroup(
    ctx: TaskContext,
    condition: ConditionRequireGroup
): Promise<void> { }

async function importCompareVar(
    ctx: TaskContext,
    condition: ConditionCompareVar
): Promise<void> { }

async function importRequirePermission(
    ctx: TaskContext,
    condition: ConditionRequirePermission
): Promise<void> { }

async function importIsInRegion(
    ctx: TaskContext,
    condition: ConditionIsInRegion
): Promise<void> { }

async function importRequireItem(
    ctx: TaskContext,
    condition: ConditionRequireItem
): Promise<void> { }

async function importIsDoingParkour(
    ctx: TaskContext,
    condition: ConditionIsDoingParkour
): Promise<void> { }

async function importRequirePotionEffect(
    ctx: TaskContext,
    condition: ConditionRequirePotionEffect
): Promise<void> { }

async function importIsSneaking(
    ctx: TaskContext,
    condition: ConditionIsSneaking
): Promise<void> { }

async function importIsFlying(
    ctx: TaskContext,
    condition: ConditionIsFlying
): Promise<void> { }

async function importCompareHealth(
    ctx: TaskContext,
    condition: ConditionCompareHealth
): Promise<void> { }

async function importCompareMaxHealth(
    ctx: TaskContext,
    condition: ConditionCompareMaxHealth
): Promise<void> { }

async function importCompareHunger(
    ctx: TaskContext,
    condition: ConditionCompareHunger
): Promise<void> { }

async function importRequireGamemode(
    ctx: TaskContext,
    condition: ConditionRequireGamemode
): Promise<void> { }

async function importComparePlaceholder(
    ctx: TaskContext,
    condition: ConditionComparePlaceholder
): Promise<void> { }

async function importRequireTeam(
    ctx: TaskContext,
    condition: ConditionRequireTeam
): Promise<void> { }

async function importCompareDamage(
    ctx: TaskContext,
    condition: ConditionCompareDamage
): Promise<void> { }
