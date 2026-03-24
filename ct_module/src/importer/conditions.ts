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
import {
    clickGoBack,
    findMenuOptionByLore,
    openSubmenu,
    readBooleanValue,
    readStringValue,
    setCycleValue,
    waitForMenu,
} from "./helpers";
import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { Diagnostic } from "htsw";

// Shape of Conditions w/ read & write methods
type ConditionSpec<T extends Condition> = {
    displayName: string;
    read?: (ctx: TaskContext) => Promise<T>;
    write: (ctx: TaskContext, desired: T, current?: T) => Promise<void>;
};

type ConditionSpecMap = {
    [K in Condition["type"]]: ConditionSpec<Extract<Condition, { type: K }>>;
};

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;

// Getter for the generic importCondition function to get
// the correct spec with type safety (annoying runtime thing)
function getConditionSpec<T extends Condition["type"]>(
    type: T,
): ConditionSpec<Extract<Condition, { type: T }>> {
    return CONDITION_SPECS[type] as ConditionSpec<
        Extract<Condition, { type: T }>
    >;
}

function isLimitExceeded(slot: ItemSlot): boolean {
    const lore = slot.getItem().getLore();
    if (lore.length === 0) return false;
    const lastLine = lore[lore.length - 1];
    return (
        removedFormatting(lastLine) === "You can't have more of this condition!"
    );
}

function normalizeOptionalBoolean(value: boolean | undefined): boolean {
    return value === true;
}

function readSelectedMenuItemName(slot: ItemSlot | null): string | undefined {
    if (slot === null) {
        return undefined;
    }

    const name = removedFormatting(slot.getItem().getName()).trim();
    return name === "" ? undefined : name;
}

async function readRequireGroup(
    ctx: TaskContext,
): Promise<ConditionRequireGroup> {
    const includeHigherGroups =
        readBooleanValue(ctx.getItemSlot("Include Higher Groups")) ?? false;

    let group = readStringValue(ctx.getItemSlot("Required Group")) ?? undefined;
    if (!group) {
        await openSubmenu(ctx, "Required Group");
        group = readSelectedMenuItemName(
            findMenuOptionByLore(ctx, "Already Selected"),
        );
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
    current?: ConditionRequireGroup,
): Promise<void> {
    if (condition.group && condition.group !== current?.group) {
        await openSubmenu(ctx, "Required Group");

        const selectedGroup = readSelectedMenuItemName(
            findMenuOptionByLore(ctx, "Already Selected"),
        );

        if (selectedGroup !== condition.group) {
            ctx.getItemSlot(condition.group).click();
            await waitForMenu(ctx);
        } else {
            await clickGoBack(ctx);
        }
    }

    const desiredIncludeHigherGroups = normalizeOptionalBoolean(
        condition.includeHigherGroups,
    );
    const currentIncludeHigherGroups =
        current !== undefined
            ? normalizeOptionalBoolean(current.includeHigherGroups)
            : (readBooleanValue(ctx.getItemSlot("Include Higher Groups")) ??
              false);

    if (desiredIncludeHigherGroups !== currentIncludeHigherGroups) {
        ctx.getItemSlot("Include Higher Groups").click();
        await waitForMenu(ctx);
    }
}

async function importCompareVar(
    ctx: TaskContext,
    condition: ConditionCompareVar,
): Promise<void> {
    if (condition.holder) {
        await setCycleValue(
            ctx,
            "Holder",
            VAR_HOLDER_OPTIONS,
            condition.holder.type,
        );
    }
}

async function importRequirePermission(
    _ctx: TaskContext,
    _condition: ConditionRequirePermission,
): Promise<void> {}

async function importIsInRegion(
    _ctx: TaskContext,
    _condition: ConditionIsInRegion,
): Promise<void> {}

async function importRequireItem(
    _ctx: TaskContext,
    _condition: ConditionRequireItem,
): Promise<void> {}

async function importIsDoingParkour(
    _ctx: TaskContext,
    _condition: ConditionIsDoingParkour,
): Promise<void> {}

async function importRequirePotionEffect(
    _ctx: TaskContext,
    _condition: ConditionRequirePotionEffect,
): Promise<void> {}

async function importIsSneaking(
    _ctx: TaskContext,
    _condition: ConditionIsSneaking,
): Promise<void> {}

async function importIsFlying(
    _ctx: TaskContext,
    _condition: ConditionIsFlying,
): Promise<void> {}

async function importCompareHealth(
    _ctx: TaskContext,
    _condition: ConditionCompareHealth,
): Promise<void> {}

async function importCompareMaxHealth(
    _ctx: TaskContext,
    _condition: ConditionCompareMaxHealth,
): Promise<void> {}

async function importCompareHunger(
    _ctx: TaskContext,
    _condition: ConditionCompareHunger,
): Promise<void> {}

async function importRequireGamemode(
    _ctx: TaskContext,
    _condition: ConditionRequireGamemode,
): Promise<void> {}

async function importComparePlaceholder(
    _ctx: TaskContext,
    _condition: ConditionComparePlaceholder,
): Promise<void> {}

async function importRequireTeam(
    _ctx: TaskContext,
    _condition: ConditionRequireTeam,
): Promise<void> {}

async function importCompareDamage(
    _ctx: TaskContext,
    _condition: ConditionCompareDamage,
): Promise<void> {}

const CONDITION_SPECS = {
    REQUIRE_GROUP: {
        displayName: "Required Group",
        read: readRequireGroup,
        write: writeRequireGroup,
    },
    COMPARE_VAR: {
        displayName: "Variable Requirement",
        write: importCompareVar,
    },
    REQUIRE_PERMISSION: {
        displayName: "Required Permission",
        write: importRequirePermission,
    },
    IS_IN_REGION: {
        displayName: "Within Region",
        write: importIsInRegion,
    },
    REQUIRE_ITEM: {
        displayName: "Has Item",
        write: importRequireItem,
    },
    IS_DOING_PARKOUR: {
        displayName: "Doing Parkour",
        write: importIsDoingParkour,
    },
    REQUIRE_POTION_EFFECT: {
        displayName: "Has Potion Effect",
        write: importRequirePotionEffect,
    },
    IS_SNEAKING: {
        displayName: "Player Sneaking",
        write: importIsSneaking,
    },
    IS_FLYING: {
        displayName: "Player Flying",
        write: importIsFlying,
    },
    COMPARE_HEALTH: {
        displayName: "Player Health",
        write: importCompareHealth,
    },
    COMPARE_MAX_HEALTH: {
        displayName: "Max Player Health",
        write: importCompareMaxHealth,
    },
    COMPARE_HUNGER: {
        displayName: "Player Hunger",
        write: importCompareHunger,
    },
    REQUIRE_GAMEMODE: {
        displayName: "Required Gamemode",
        write: importRequireGamemode,
    },
    COMPARE_PLACEHOLDER: {
        displayName: "Placeholder Number Requirement",
        write: importComparePlaceholder,
    },
    REQUIRE_TEAM: {
        displayName: "Required Team",
        write: importRequireTeam,
    },
    COMPARE_DAMAGE: {
        displayName: "Damage Amount",
        write: importCompareDamage,
    },
} satisfies ConditionSpecMap;

// Diff-Importer by default, if read is impl'd just read and then apply
async function runConditionSpec<T extends Condition["type"]>(
    ctx: TaskContext,
    condition: Extract<Condition, { type: T }>,
) {
    const spec = getConditionSpec(condition.type);

    const current = spec.read ? await spec.read(ctx) : undefined;

    const slot = ctx.getItemSlot(spec.displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`,
        );
    }
    await spec.write(ctx, condition, current);
}

export async function readOpenCondition<T extends Condition["type"]>(
    ctx: TaskContext,
    type: T,
): Promise<Extract<Condition, { type: T }>> {
    const spec = CONDITION_SPECS[type] as ConditionSpec<
        Extract<Condition, { type: T }>
    >;
    if (!spec.read) {
        throw new Error(`Reading condition "${type}" is not implemented.`);
    }
    return spec.read(ctx);
}

export async function importCondition(
    ctx: TaskContext,
    condition: Condition,
): Promise<void> {
    ctx.getItemSlot("Add Condition").click();
    await waitForMenu(ctx);

    await runConditionSpec(ctx, condition);

    if (condition.inverted) {
        ctx.getItemSlot("Invert").click();
        await waitForMenu(ctx);
    }
}
