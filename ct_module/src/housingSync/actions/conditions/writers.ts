import {
    type Condition,
    type ConditionBlockType,
    type ConditionCompareDamage,
    type ConditionCompareHealth,
    type ConditionCompareHunger,
    type ConditionCompareMaxHealth,
    type ConditionComparePlaceholder,
    type ConditionCompareVar,
    type ConditionDamageCause,
    type ConditionFishingEnvironment,
    type ConditionIsInRegion,
    type ConditionIsItem,
    type ConditionPortalType,
    type ConditionRequireGamemode,
    type ConditionRequireGroup,
    type ConditionRequireItem,
    type ConditionRequirePermission,
    type ConditionRequirePotionEffect,
    type ConditionRequireTeam,
} from "htsw/types";

import TaskContext from "../../../tasks/context";
import { type ItemRegistry } from "../../../importables/itemRegistry";
import {
    clickGoBack,
    findMenuOptionByLore,
    getSlotPaginate,
    openSubmenu,
    readBooleanValue,
    readStringValue,
    setBooleanValue,
    setCycleValue,
    setSelectValue,
    setStringValue,
} from "../../menus/menuUtils";
import { waitForMenu } from "../../menus/menuWait";
import { removedFormatting } from "../../../utils/helpers";
import {
    getConditionFieldCycleOptions,
    getConditionFieldDefault,
    getConditionFieldLabel,
} from "../../fields/conditionMappings";
import { setItemValue } from "../../items/injectItem";
import { resolveImportableItem } from "../../items/resolveItem";

function conditionDefault<T>(type: Condition["type"], prop: string): T {
    return getConditionFieldDefault(type, prop) as T;
}

export async function readRequireGroup(ctx: TaskContext): Promise<ConditionRequireGroup> {
    const groupLabel = getConditionFieldLabel("REQUIRE_GROUP", "group");
    const includeHigherGroupsLabel = getConditionFieldLabel(
        "REQUIRE_GROUP",
        "includeHigherGroups"
    );

    const includeHigherGroups =
        readBooleanValue(ctx.getMenuItemSlot(includeHigherGroupsLabel)) ?? false;

    let group = readStringValue(ctx.getMenuItemSlot(groupLabel)) ?? undefined;
    if (!group) {
        await openSubmenu(ctx, groupLabel);
        const selectedSlot = findMenuOptionByLore(ctx, "Already Selected");
        group = selectedSlot
            ? removedFormatting(selectedSlot.getItem().getName()).trim()
            : undefined;
        await clickGoBack(ctx);
    }

    const condition: ConditionRequireGroup = {
        type: "REQUIRE_GROUP",
    };

    if (group) {
        condition.group = group;
    }

    if (includeHigherGroups) {
        condition.includeHigherGroups = true;
    }

    return condition;
}

export async function writeRequireGroup(
    ctx: TaskContext,
    condition: ConditionRequireGroup,
    current?: ConditionRequireGroup
): Promise<void> {
    if (condition.group && condition.group !== current?.group) {
        await openSubmenu(ctx, getConditionFieldLabel("REQUIRE_GROUP", "group"));

        const selectedSlot = findMenuOptionByLore(ctx, "Already Selected");
        const selectedGroup = selectedSlot
            ? removedFormatting(selectedSlot.getItem().getName()).trim()
            : undefined;

        if (selectedGroup !== condition.group) {
            const groupSlot = await getSlotPaginate(ctx, condition.group);
            groupSlot.click();
            await waitForMenu(ctx);
        } else {
            await clickGoBack(ctx);
        }
    }

    await setBooleanValue(
        ctx,
        ctx.getMenuItemSlot(getConditionFieldLabel("REQUIRE_GROUP", "includeHigherGroups")),
        condition.includeHigherGroups ?? conditionDefault<boolean>("REQUIRE_GROUP", "includeHigherGroups")
    );
}

export async function writeCompareVar(
    ctx: TaskContext,
    condition: ConditionCompareVar
): Promise<void> {
    if (condition.holder) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("COMPARE_VAR", "holder"),
            getConditionFieldCycleOptions("COMPARE_VAR", "holder"),
            condition.holder.type
        );
        if (condition.holder.type === "Team" && condition.holder.team !== undefined) {
            await setSelectValue(ctx, "Team", condition.holder.team);
        }
    }

    if (condition.var) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_VAR", "var")),
            condition.var
        );
    }

    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_VAR", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_VAR", "amount")),
            condition.amount
        );
    }

    await setStringValue(
        ctx,
        ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_VAR", "fallback")),
        condition.fallback ?? conditionDefault<string>("COMPARE_VAR", "fallback")
    );
}

export async function writeRequirePermission(
    ctx: TaskContext,
    condition: ConditionRequirePermission
): Promise<void> {
    if (condition.permission) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("REQUIRE_PERMISSION", "permission"),
            condition.permission
        );
    }
}

export async function writeIsInRegion(
    ctx: TaskContext,
    condition: ConditionIsInRegion
): Promise<void> {
    if (condition.region) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("IS_IN_REGION", "region"),
            condition.region
        );
    }
}

export async function writeRequireItem(
    ctx: TaskContext,
    condition: ConditionRequireItem,
    _current: ConditionRequireItem | undefined,
    itemRegistry: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("REQUIRE_ITEM", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }

    await setCycleValue(
        ctx,
        getConditionFieldLabel("REQUIRE_ITEM", "whatToCheck"),
        getConditionFieldCycleOptions("REQUIRE_ITEM", "whatToCheck"),
        condition.whatToCheck ?? conditionDefault<string>("REQUIRE_ITEM", "whatToCheck")
    );

    await setSelectValue(
        ctx,
        getConditionFieldLabel("REQUIRE_ITEM", "whereToCheck"),
        condition.whereToCheck ?? conditionDefault<string>("REQUIRE_ITEM", "whereToCheck")
    );

    await setCycleValue(
        ctx,
        getConditionFieldLabel("REQUIRE_ITEM", "amount"),
        getConditionFieldCycleOptions("REQUIRE_ITEM", "amount"),
        condition.amount ?? conditionDefault<string>("REQUIRE_ITEM", "amount")
    );
}

export async function writeRequirePotionEffect(
    ctx: TaskContext,
    condition: ConditionRequirePotionEffect
): Promise<void> {
    if (condition.effect) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("REQUIRE_POTION_EFFECT", "effect"),
            condition.effect
        );
    }
}

export async function writeCompareHealth(
    ctx: TaskContext,
    condition: ConditionCompareHealth
): Promise<void> {
    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_HEALTH", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_HEALTH", "amount")),
            condition.amount
        );
    }
}

export async function writeCompareMaxHealth(
    ctx: TaskContext,
    condition: ConditionCompareMaxHealth
): Promise<void> {
    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_MAX_HEALTH", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_MAX_HEALTH", "amount")),
            condition.amount
        );
    }
}

export async function writeCompareHunger(
    ctx: TaskContext,
    condition: ConditionCompareHunger
): Promise<void> {
    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_HUNGER", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_HUNGER", "amount")),
            condition.amount
        );
    }
}

export async function writeRequireGamemode(
    ctx: TaskContext,
    condition: ConditionRequireGamemode
): Promise<void> {
    if (condition.gamemode) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("REQUIRE_GAMEMODE", "gamemode"),
            getConditionFieldCycleOptions("REQUIRE_GAMEMODE", "gamemode"),
            condition.gamemode
        );
    }
}

export async function writeComparePlaceholder(
    ctx: TaskContext,
    condition: ConditionComparePlaceholder
): Promise<void> {
    if (condition.placeholder) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_PLACEHOLDER", "placeholder")),
            condition.placeholder
        );
    }

    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_PLACEHOLDER", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_PLACEHOLDER", "amount")),
            condition.amount
        );
    }
}

export async function writeRequireTeam(
    ctx: TaskContext,
    condition: ConditionRequireTeam
): Promise<void> {
    if (condition.team) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("REQUIRE_TEAM", "team"),
            condition.team
        );
    }
}

export async function writeDamageCause(
    ctx: TaskContext,
    condition: ConditionDamageCause
): Promise<void> {
    if (condition.cause) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("DAMAGE_CAUSE", "cause"),
            condition.cause
        );
    }
}

export async function writeFishingEnvironment(
    ctx: TaskContext,
    condition: ConditionFishingEnvironment
): Promise<void> {
    if (condition.environment) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("FISHING_ENVIRONMENT", "environment"),
            getConditionFieldCycleOptions("FISHING_ENVIRONMENT", "environment"),
            condition.environment
        );
    }
}

export async function writePortalType(
    ctx: TaskContext,
    condition: ConditionPortalType
): Promise<void> {
    if (condition.portalType) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("PORTAL_TYPE", "portalType"),
            condition.portalType
        );
    }
}

export async function writeBlockType(
    ctx: TaskContext,
    condition: ConditionBlockType,
    _current: ConditionBlockType | undefined,
    itemRegistry: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("BLOCK_TYPE", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }
}

export async function writeIsItem(
    ctx: TaskContext,
    condition: ConditionIsItem,
    _current: ConditionIsItem | undefined,
    itemRegistry: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("IS_ITEM", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }
}

export async function writeCompareDamage(
    ctx: TaskContext,
    condition: ConditionCompareDamage
): Promise<void> {
    if (condition.op) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("COMPARE_DAMAGE", "op"),
            condition.op
        );
    }

    if (condition.amount) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_DAMAGE", "amount")),
            condition.amount
        );
    }
}
