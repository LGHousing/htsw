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

import type { Step } from "./step";
import { stepsClickButtonThenSelectValue, stepGoBack } from "./helpers";
import { stepsClickSlotThenSelect, stepsNumber, stepsString, stepsToggle } from "./stepHelpers";

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

export function stepsForCondition(condition: Condition): Step[] {
    const steps: Step[] = [];

    steps.push(
        ...stepsClickButtonThenSelectValue(
            "Add Condition",
            CONDITION_DISPLAY_NAMES[condition.type]
        )
    );

    steps.push(...stepsForConditionSettings(condition));
    steps.push(stepGoBack());

    return steps;
}

function stepsForConditionSettings(condition: Condition): Step[] {
    switch (condition.type) {
        case "REQUIRE_GROUP":
            return stepsForRequireGroup(condition);
        case "COMPARE_VAR":
            return stepsForCompareVar(condition);
        case "REQUIRE_PERMISSION":
            return stepsForRequirePermission(condition);
        case "IS_IN_REGION":
            return stepsForIsInRegion(condition);
        case "REQUIRE_ITEM":
            return stepsForRequireItem(condition);
        case "IS_DOING_PARKOUR":
            return stepsForIsDoingParkour(condition);
        case "REQUIRE_POTION_EFFECT":
            return stepsForRequirePotionEffect(condition);
        case "IS_SNEAKING":
            return stepsForIsSneaking(condition);
        case "IS_FLYING":
            return stepsForIsFlying(condition);
        case "COMPARE_HEALTH":
            return stepsForCompareHealth(condition);
        case "COMPARE_MAX_HEALTH":
            return stepsForCompareMaxHealth(condition);
        case "COMPARE_HUNGER":
            return stepsForCompareHunger(condition);
        case "REQUIRE_GAMEMODE":
            return stepsForRequireGamemode(condition);
        case "COMPARE_PLACEHOLDER":
            return stepsForComparePlaceholder(condition);
        case "REQUIRE_TEAM":
            return stepsForRequireTeam(condition);
        case "COMPARE_DAMAGE":
            return stepsForCompareDamage(condition);
        default:
            return [];
    }
}

function stepsForRequireGroup(condition: ConditionRequireGroup): Step[] {
    const steps: Step[] = [];

    steps.push(...stepsClickSlotThenSelect(10, condition.group ?? ""));
    steps.push(...stepsToggle(11, condition.includeHigherGroups, false));

    return steps;
}

function stepsForCompareVar(condition: ConditionCompareVar): Step[] {
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

function stepsForRequirePermission(condition: ConditionRequirePermission): Step[] {
    const steps: Step[] = [];

    if (condition.permission) {
        steps.push(...stepsClickSlotThenSelect(10, condition.permission));
    }

    return steps;
}

function stepsForIsInRegion(condition: ConditionIsInRegion): Step[] {
    const steps: Step[] = [];

    if (condition.region) {
        steps.push(...stepsClickSlotThenSelect(10, condition.region));
    }

    return steps;
}

function stepsForRequireItem(condition: ConditionRequireItem): Step[] {
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

function stepsForIsDoingParkour(condition: ConditionIsDoingParkour): Step[] {
    return [];
}

function stepsForRequirePotionEffect(condition: ConditionRequirePotionEffect): Step[] {
    const steps: Step[] = [];

    if (condition.effect) {
        steps.push(...stepsClickSlotThenSelect(10, condition.effect));
    }

    return steps;
}

function stepsForIsSneaking(condition: ConditionIsSneaking): Step[] {
    return [];
}

function stepsForIsFlying(condition: ConditionIsFlying): Step[] {
    return [];
}

function stepsForCompareHealth(condition: ConditionCompareHealth): Step[] {
    return stepsForCompareNumberCondition(condition, 10, 11);
}

function stepsForCompareMaxHealth(condition: ConditionCompareMaxHealth): Step[] {
    return stepsForCompareNumberCondition(condition, 10, 11);
}

function stepsForCompareHunger(condition: ConditionCompareHunger): Step[] {
    return stepsForCompareNumberCondition(condition, 10, 11);
}

function stepsForRequireGamemode(condition: ConditionRequireGamemode): Step[] {
    const steps: Step[] = [];

    if (condition.gamemode) {
        steps.push(...stepsClickSlotThenSelect(10, condition.gamemode));
    }

    return steps;
}

function stepsForComparePlaceholder(condition: ConditionComparePlaceholder): Step[] {
    const steps: Step[] = [];

    steps.push(...stepsString(10, condition.placeholder));
    if (condition.op) {
        steps.push(...stepsClickSlotThenSelect(11, comparisonToUi(condition.op)));
    }
    steps.push(...stepsString(12, condition.amount));

    return steps;
}

function stepsForRequireTeam(condition: ConditionRequireTeam): Step[] {
    const steps: Step[] = [];

    if (condition.team) {
        steps.push(...stepsClickSlotThenSelect(10, condition.team));
    }

    return steps;
}

function stepsForCompareDamage(condition: ConditionCompareDamage): Step[] {
    return stepsForCompareNumberCondition(condition, 10, 11);
}

function stepsForCompareNumberCondition(
    condition: { op?: string; amount?: string; inverted?: boolean },
    opSlot: number,
    valueSlot: number
): Step[] {
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
