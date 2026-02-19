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

export async function importCondition(ctx: TaskContext, condition: Condition): Promise<void> {
    const steps: Step[] = [];

    steps.push(
        ...stepsClickButtonThenSelectValue(
            "Add Condition",
            CONDITION_DISPLAY_NAMES[condition.type]
        )
    );

    steps.push(...importConditionSettings(ctx, condition));
    steps.push(stepGoBack());

    return steps;
}

async function importConditionSettings(ctx: TaskContext, condition: Condition): Promise<void> {
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

async function importRequireGroup(ctx: TaskContext, condition: ConditionRequireGroup): Promise<void> {
    const steps: Step[] = [];

    steps.push(...stepsClickSlotThenSelect(10, condition.group ?? ""));
    steps.push(...stepsToggle(11, condition.includeHigherGroups, false));

    return steps;
}

async function importCompareVar(ctx: TaskContext, condition: ConditionCompareVar): Promise<void> {
    const steps: Step[] = [];

    const holder = condition.holder?.type ?? "player";
    const holderLabel = holder === "global" ? "Global" : holder === "team" ? "Team" : "Player";

    steps.push(...stepsClickSlotThenSelect(10, holderLabel));

    const slotShift = condition.holder?.type === "team" ? 1 : 0;

    if (condition.holder?.type === "team" && condition.holder?.team) {
        steps.push(...stepsClickSlotThenSelect(11, condition.holder.team));
    }

    steps.push(...stepsString(11 + slotShift, condition.var));
    if (condition.op) {
        steps.push(...stepsClickSlotThenSelect(12 + slotShift, comparisonToUi(condition.op)));
    }
    steps.push(...stepsString(14 + slotShift, condition.amount));
    steps.push(...stepsString(15 + slotShift, condition.fallback));

    return steps;
}

async function importRequirePermission(ctx: TaskContext, condition: ConditionRequirePermission): Promise<void> {
    const steps: Step[] = [];

    if (condition.permission) {
        steps.push(...stepsClickSlotThenSelect(10, condition.permission));
    }

    return steps;
}

async function importIsInRegion(ctx: TaskContext, condition: ConditionIsInRegion): Promise<void> {
    const steps: Step[] = [];

    if (condition.region) {
        steps.push(...stepsClickSlotThenSelect(10, condition.region));
    }

    return steps;
}

async function importRequireItem(ctx: TaskContext, condition: ConditionRequireItem): Promise<void> {
    const steps: Step[] = [];

    if (condition.item) {
        steps.push({ type: "CLICK_SLOT", slot: 10 });
        steps.push({ type: "SELECT_ITEM", item: condition.item });
    }
    if (condition.whatToCheck) {
        steps.push(...stepsClickSlotThenSelect(11, condition.whatToCheck));
    }
    if (condition.whereToCheck) {
        steps.push(...stepsClickSlotThenSelect(12, condition.whereToCheck));
    }
    if (condition.amount) {
        steps.push(...stepsClickSlotThenSelect(13, condition.amount));
    }

    return steps;
}

async function importIsDoingParkour(ctx: TaskContext, condition: ConditionIsDoingParkour): Promise<void> {
    return [];
}

async function importRequirePotionEffect(ctx: TaskContext, condition: ConditionRequirePotionEffect): Promise<void> {
    const steps: Step[] = [];

    if (condition.effect) {
        steps.push(...stepsClickSlotThenSelect(10, condition.effect));
    }

    return steps;
}

async function importIsSneaking(ctx: TaskContext, condition: ConditionIsSneaking): Promise<void> {
    return [];
}

async function importIsFlying(ctx: TaskContext, condition: ConditionIsFlying): Promise<void> {
    return [];
}

async function importCompareHealth(ctx: TaskContext, condition: ConditionCompareHealth): Promise<void> {
    return importCompareNumberCondition(ctx, condition, 10, 11);
}

async function importCompareMaxHealth(ctx: TaskContext, condition: ConditionCompareMaxHealth): Promise<void> {
    return importCompareNumberCondition(ctx, condition, 10, 11);
}

async function importCompareHunger(ctx: TaskContext, condition: ConditionCompareHunger): Promise<void> {
    return importCompareNumberCondition(ctx, condition, 10, 11);
}

async function importRequireGamemode(ctx: TaskContext, condition: ConditionRequireGamemode): Promise<void> {
    const steps: Step[] = [];

    if (condition.gamemode) {
        steps.push(...stepsClickSlotThenSelect(10, condition.gamemode));
    }

    return steps;
}

async function importComparePlaceholder(ctx: TaskContext, condition: ConditionComparePlaceholder): Promise<void> {
    const steps: Step[] = [];

    steps.push(...stepsString(10, condition.placeholder));
    if (condition.op) {
        steps.push(...stepsClickSlotThenSelect(11, comparisonToUi(condition.op)));
    }
    steps.push(...stepsString(12, condition.amount));

    return steps;
}

async function importRequireTeam(ctx: TaskContext, condition: ConditionRequireTeam): Promise<void> {
    const steps: Step[] = [];

    if (condition.team) {
        steps.push(...stepsClickSlotThenSelect(10, condition.team));
    }

    return steps;
}

async function importCompareDamage(ctx: TaskContext, condition: ConditionCompareDamage): Promise<void> {
    return importCompareNumberCondition(ctx, condition, 10, 11);
}

async function importCompareNumberCondition(ctx: TaskContext, 
    condition: { op?: string; amount?: string; inverted?: boolean },
    opSlot: number,
    valueSlot: number
): Promise<void> {
    const steps: Step[] = [];

    if (condition.op) {
        steps.push(...stepsClickSlotThenSelect(opSlot, comparisonToUi(condition.op)));
    }
    steps.push(...stepsString(valueSlot, condition.amount));

    return steps;
}

function comparisonToUi(op: string): string {
    if (op === "Less Than Or Equal") return "Less Than or Equal";
    if (op === "Greater Than Or Equal") return "Greater Than or Equal";
    return op;
}
