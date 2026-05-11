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

import TaskContext from "../tasks/context";
import { type ItemRegistry } from "../importables/itemRegistry";
import {
    VAR_HOLDER_OPTIONS,
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
    waitForMenu,
} from "./helpers";
import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import {
    CONDITION_MAPPINGS,
    getConditionFieldLabel,
} from "./conditionMappings";
import { onlyNoteDiffers } from "./conditions/diff";
import { setItemValue } from "./items";
import { resolveImportableItem } from "./resolveItem";

export {
    readConditionList,
    readConditionsListPage,
    canonicalizeObservedConditionItemNames,
} from "./conditions/readList";
export type { ReadConditionListOptions } from "./conditions/readList";
export {
    syncConditionList,
} from "./conditions/sync";
export type {
    SyncConditionListOptions,
    SyncConditionListResult,
} from "./conditions/sync";

type ConditionSpec<T extends Condition> = {
    displayName: string;
    read?: (ctx: TaskContext) => Promise<T>;
    write?: (
        ctx: TaskContext,
        desired: T,
        current?: T,
        itemRegistry?: ItemRegistry
    ) => Promise<void>;
};

type ConditionSpecMap = {
    [K in Condition["type"]]: ConditionSpec<Extract<Condition, { type: K }>>;
};

const GAMEMODE_OPTIONS = ["Adventure", "Survival", "Creative"] as const;
const FISHING_ENVIRONMENT_OPTIONS = ["Water", "Lava"] as const;
const ITEM_PROPERTY_OPTIONS = ["Item Type", "Metadata"] as const;
const ITEM_AMOUNT_OPTIONS = ["Any Amount", "Equal or Greater Amount"] as const;

export function getConditionSpec<T extends Condition["type"]>(
    type: T
): ConditionSpec<Extract<Condition, { type: T }>> {
    return CONDITION_SPECS[type] as ConditionSpec<Extract<Condition, { type: T }>>;
}

export function isConditionListItemInverted(slot: ItemSlot): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) => removedFormatting(line).trim() === "Inverted");
}

async function readRequireGroup(ctx: TaskContext): Promise<ConditionRequireGroup> {
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

async function writeRequireGroup(
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
        condition.includeHigherGroups === true
    );
}

async function writeCompareVar(
    ctx: TaskContext,
    condition: ConditionCompareVar
): Promise<void> {
    if (condition.holder) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("COMPARE_VAR", "holder"),
            VAR_HOLDER_OPTIONS,
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

    if (condition.fallback) {
        await setStringValue(
            ctx,
            ctx.getMenuItemSlot(getConditionFieldLabel("COMPARE_VAR", "fallback")),
            condition.fallback
        );
    }
}

async function writeRequirePermission(
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

async function writeIsInRegion(
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

async function writeRequireItem(
    ctx: TaskContext,
    condition: ConditionRequireItem,
    _current?: ConditionRequireItem,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("REQUIRE_ITEM", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }

    if (condition.whatToCheck) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("REQUIRE_ITEM", "whatToCheck"),
            ITEM_PROPERTY_OPTIONS,
            condition.whatToCheck
        );
    }

    if (condition.whereToCheck) {
        await setSelectValue(
            ctx,
            getConditionFieldLabel("REQUIRE_ITEM", "whereToCheck"),
            condition.whereToCheck
        );
    }

    if (condition.amount) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("REQUIRE_ITEM", "amount"),
            ITEM_AMOUNT_OPTIONS,
            condition.amount
        );
    }
}

async function writeRequirePotionEffect(
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

async function writeCompareHealth(
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

async function writeCompareMaxHealth(
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

async function writeCompareHunger(
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

async function writeRequireGamemode(
    ctx: TaskContext,
    condition: ConditionRequireGamemode
): Promise<void> {
    if (condition.gamemode) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("REQUIRE_GAMEMODE", "gamemode"),
            GAMEMODE_OPTIONS,
            condition.gamemode
        );
    }
}

async function writeComparePlaceholder(
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

async function writeRequireTeam(
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

async function writeDamageCause(
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

async function writeFishingEnvironment(
    ctx: TaskContext,
    condition: ConditionFishingEnvironment
): Promise<void> {
    if (condition.environment) {
        await setCycleValue(
            ctx,
            getConditionFieldLabel("FISHING_ENVIRONMENT", "environment"),
            FISHING_ENVIRONMENT_OPTIONS,
            condition.environment
        );
    }
}

async function writePortalType(
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

async function writeBlockType(
    ctx: TaskContext,
    condition: ConditionBlockType,
    _current?: ConditionBlockType,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("BLOCK_TYPE", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }
}

async function writeIsItem(
    ctx: TaskContext,
    condition: ConditionIsItem,
    _current?: ConditionIsItem,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (condition.itemName) {
        await setItemValue(
            ctx,
            getConditionFieldLabel("IS_ITEM", "itemName"),
            await resolveImportableItem(ctx, itemRegistry, condition, condition.itemName, "condition")
        );
    }
}

async function writeCompareDamage(
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

const CONDITION_SPECS = {
    REQUIRE_GROUP: {
        displayName: CONDITION_MAPPINGS.REQUIRE_GROUP.displayName,
        read: readRequireGroup,
        write: writeRequireGroup,
    },
    COMPARE_VAR: {
        displayName: CONDITION_MAPPINGS.COMPARE_VAR.displayName,
        write: writeCompareVar,
    },
    REQUIRE_PERMISSION: {
        displayName: CONDITION_MAPPINGS.REQUIRE_PERMISSION.displayName,
        write: writeRequirePermission,
    },
    IS_IN_REGION: {
        displayName: CONDITION_MAPPINGS.IS_IN_REGION.displayName,
        write: writeIsInRegion,
    },
    REQUIRE_ITEM: {
        displayName: CONDITION_MAPPINGS.REQUIRE_ITEM.displayName,
        write: writeRequireItem,
    },
    IS_DOING_PARKOUR: {
        displayName: CONDITION_MAPPINGS.IS_DOING_PARKOUR.displayName,
    },
    REQUIRE_POTION_EFFECT: {
        displayName: CONDITION_MAPPINGS.REQUIRE_POTION_EFFECT.displayName,
        write: writeRequirePotionEffect,
    },
    IS_SNEAKING: {
        displayName: CONDITION_MAPPINGS.IS_SNEAKING.displayName,
    },
    IS_FLYING: {
        displayName: CONDITION_MAPPINGS.IS_FLYING.displayName,
    },
    COMPARE_HEALTH: {
        displayName: CONDITION_MAPPINGS.COMPARE_HEALTH.displayName,
        write: writeCompareHealth,
    },
    COMPARE_MAX_HEALTH: {
        displayName: CONDITION_MAPPINGS.COMPARE_MAX_HEALTH.displayName,
        write: writeCompareMaxHealth,
    },
    COMPARE_HUNGER: {
        displayName: CONDITION_MAPPINGS.COMPARE_HUNGER.displayName,
        write: writeCompareHunger,
    },
    REQUIRE_GAMEMODE: {
        displayName: CONDITION_MAPPINGS.REQUIRE_GAMEMODE.displayName,
        write: writeRequireGamemode,
    },
    COMPARE_PLACEHOLDER: {
        displayName: CONDITION_MAPPINGS.COMPARE_PLACEHOLDER.displayName,
        write: writeComparePlaceholder,
    },
    REQUIRE_TEAM: {
        displayName: CONDITION_MAPPINGS.REQUIRE_TEAM.displayName,
        write: writeRequireTeam,
    },
    DAMAGE_CAUSE: {
        displayName: CONDITION_MAPPINGS.DAMAGE_CAUSE.displayName,
        write: writeDamageCause,
    },
    PVP_ENABLED: {
        displayName: CONDITION_MAPPINGS.PVP_ENABLED.displayName,
    },
    FISHING_ENVIRONMENT: {
        displayName: CONDITION_MAPPINGS.FISHING_ENVIRONMENT.displayName,
        write: writeFishingEnvironment,
    },
    PORTAL_TYPE: {
        displayName: CONDITION_MAPPINGS.PORTAL_TYPE.displayName,
        write: writePortalType,
    },
    BLOCK_TYPE: {
        displayName: CONDITION_MAPPINGS.BLOCK_TYPE.displayName,
        write: writeBlockType,
    },
    IS_ITEM: {
        displayName: CONDITION_MAPPINGS.IS_ITEM.displayName,
        write: writeIsItem,
    },
    COMPARE_DAMAGE: {
        displayName: CONDITION_MAPPINGS.COMPARE_DAMAGE.displayName,
        write: writeCompareDamage,
    },
} satisfies ConditionSpecMap;

export async function writeOpenCondition(
    ctx: TaskContext,
    condition: Condition,
    current?: Condition,
    itemRegistry?: ItemRegistry
): Promise<void> {
    // Notes are written from the list item, not the editor.
    if (current && onlyNoteDiffers(condition, current)) {
        return;
    }

    const spec = getConditionSpec(condition.type);
    // When adding new conditions, read the current values to avoid
    // unnecessarily overwriting fields that aren't changing.
    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx);
    }

    if (spec.write) {
        await spec.write(ctx, condition, resolvedCurrent, itemRegistry);
    }
}
