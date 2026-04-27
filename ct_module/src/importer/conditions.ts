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
    type ConditionIsDoingParkour,
    type ConditionIsFlying,
    type ConditionIsInRegion,
    type ConditionIsItem,
    type ConditionIsSneaking,
    type ConditionPortalType,
    type ConditionPvpEnabled,
    type ConditionRequireGamemode,
    type ConditionRequireGroup,
    type ConditionRequireItem,
    type ConditionRequirePermission,
    type ConditionRequirePotionEffect,
    type ConditionRequireTeam,
} from "htsw/types";

import TaskContext from "../tasks/context";
import {
    type ItemRegistry,
    getMemoizedHousingUuid,
} from "../importables/itemRegistry";
import {
    clickGoBack,
    findMenuOptionByLore,
    openSubmenu,
    readBooleanValue,
    readStringValue,
    setBooleanValue,
    setCycleValue,
    setSelectValue,
    setStringValue,
    setListItemNote,
    waitForMenu,
} from "./helpers";
import { ItemSlot, MouseButton } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { getItemFromSnbt } from "../utils/nbt";
import { importableHash } from "../knowledge";
import {
    CONDITION_LORE_MAPPINGS,
    getConditionFieldLabel,
    parseConditionListItem,
    tryGetConditionTypeFromDisplayName,
} from "./conditionMappings";
import { Diagnostic } from "htsw";
import { ObservedConditionSlot } from "./types";
import {
    type ConditionListDiff,
    diffConditionList,
    onlyNoteDiffers,
} from "./conditions/diff";
import {
    clickPaginatedNextPage,
    getCurrentPaginatedListPageState,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    type PaginatedListConfig,
} from "./paginatedList";
import { setItemValue } from "./items";

export { diffConditionList };

// Shape of Conditions w/ read & write methods
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

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;
const GAMEMODE_OPTIONS = ["Adventure", "Survival", "Creative"] as const;
const FISHING_ENVIRONMENT_OPTIONS = ["Water", "Lava"] as const;
const ITEM_PROPERTY_OPTIONS = ["Item Type", "Metadata"] as const;
const ITEM_AMOUNT_OPTIONS = ["Any Amount", "Equal or Greater Amount"] as const;

// Getter for the generic importCondition function to get
// the correct spec with type safety (annoying runtime thing)
function getConditionSpec<T extends Condition["type"]>(
    type: T
): ConditionSpec<Extract<Condition, { type: T }>> {
    return CONDITION_SPECS[type] as ConditionSpec<Extract<Condition, { type: T }>>;
}

function isLimitExceeded(slot: ItemSlot): boolean {
    const lore = slot.getItem().getLore();
    if (lore.length === 0) return false;
    const lastLine = lore[lore.length - 1];
    return removedFormatting(lastLine) === "You can't have more of this condition!";
}

async function resolveConditionItem(
    ctx: TaskContext,
    itemRegistry: ItemRegistry | undefined,
    condition: Condition,
    itemName: string
): Promise<Item> {
    if (itemRegistry === undefined) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${condition.type}: no item registry is available.`
        );
    }

    const entry = itemRegistry.resolve(itemName, condition);
    if (entry === undefined) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${condition.type}: item fields resolve against top-level items[].name or direct .snbt paths.`
        );
    }

    // See action's resolveActionItem for the reasoning. Items with click
    // actions only carry their housing-tagged NBT after a /edit round-
    // trip on the item itself, which lives in the SNBT cache.
    const importable = entry.importable;
    const hasActions =
        importable !== undefined &&
        ((importable.leftClickActions !== undefined &&
            importable.leftClickActions.length > 0) ||
            (importable.rightClickActions !== undefined &&
                importable.rightClickActions.length > 0));
    if (!hasActions) {
        return entry.item;
    }

    const uuid = await getMemoizedHousingUuid(ctx, itemRegistry);
    const hash = importableHash(importable);
    const cachePath = `./htsw/.cache/${uuid}/items/${hash}.snbt`;
    if (!FileLib.exists(cachePath)) {
        throw Diagnostic.error(
            `Cannot set item "${itemName}" for ${condition.type}: it has click actions but isn't cached at ${cachePath}. ` +
                `Declare the item as a top-level importable in the same import.json so it imports first, ` +
                `or run /import on it before whatever references it.`
        );
    }
    const snbt = String(FileLib.read(cachePath));
    return getItemFromSnbt(snbt);
}

const CONDITION_LIST_CONFIG: PaginatedListConfig = {
    label: "condition",
    emptyPlaceholderName: "No Conditions!",
};

function getVisibleConditionItemSlots(ctx: TaskContext): ItemSlot[] {
    return getVisiblePaginatedItemSlots(ctx);
}

function isNoConditionsPlaceholder(slot: ItemSlot): boolean {
    return isEmptyPaginatedPlaceholder(slot, CONDITION_LIST_CONFIG);
}

function getCurrentConditionPageState(ctx: TaskContext): {
    currentPage: number;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
} {
    return getCurrentPaginatedListPageState(ctx, CONDITION_LIST_CONFIG);
}

async function goToConditionPage(ctx: TaskContext, targetPage: number): Promise<void> {
    await goToPaginatedListPage(ctx, targetPage, CONDITION_LIST_CONFIG);
}

async function getConditionSlotAtIndex(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<ItemSlot> {
    return getPaginatedListSlotAtIndex(ctx, index, listLength, CONDITION_LIST_CONFIG);
}

export async function readConditionsListPage(
    ctx: TaskContext
): Promise<ObservedConditionSlot[]> {
    return getVisibleConditionItemSlots(ctx)
        .filter((slot) => !isNoConditionsPlaceholder(slot))
        .map((slot, index) => {
            const type = tryGetConditionTypeFromDisplayName(slot.getItem().getName());
            const observedCondition: ObservedConditionSlot = {
                index,
                slotId: slot.getSlotId(),
                slot,
                condition: null,
            };

            if (!type) {
                return observedCondition;
            }

            const condition = parseConditionListItem(slot, type);
            if (isConditionListItemInverted(slot)) {
                condition.inverted = true;
            }

            observedCondition.condition = condition;
            return observedCondition;
        });
}

// TODO: Optionally implement (in-menu) read functions for the rest of the conditons.
// This is NOT NECESSARY for conditions specifically because we can infer all data from the
// lore in the conditions list. Diff importer defaults to relying on the Condition object data
// passed in from the conditions list but can fallback to reading from the menu if read fxns are impl'd
async function readRequireGroup(ctx: TaskContext): Promise<ConditionRequireGroup> {
    const groupLabel = getConditionFieldLabel("REQUIRE_GROUP", "group");
    const includeHigherGroupsLabel = getConditionFieldLabel(
        "REQUIRE_GROUP",
        "includeHigherGroups"
    );

    const includeHigherGroups =
        readBooleanValue(ctx.getItemSlot(includeHigherGroupsLabel)) ?? false;

    let group = readStringValue(ctx.getItemSlot(groupLabel)) ?? undefined;
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
            ctx.getItemSlot(condition.group).click();
            await waitForMenu(ctx);
        } else {
            await clickGoBack(ctx);
        }
    }

    await setBooleanValue(
        ctx,
        ctx.getItemSlot(getConditionFieldLabel("REQUIRE_GROUP", "includeHigherGroups")),
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
    }

    if (condition.var) {
        await setStringValue(
            ctx,
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_VAR", "var")),
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_VAR", "amount")),
            condition.amount
        );
    }

    if (condition.fallback) {
        await setStringValue(
            ctx,
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_VAR", "fallback")),
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
            await resolveConditionItem(ctx, itemRegistry, condition, condition.itemName)
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_HEALTH", "amount")),
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_MAX_HEALTH", "amount")),
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_HUNGER", "amount")),
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_PLACEHOLDER", "placeholder")),
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_PLACEHOLDER", "amount")),
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
            await resolveConditionItem(ctx, itemRegistry, condition, condition.itemName)
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
            await resolveConditionItem(ctx, itemRegistry, condition, condition.itemName)
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
            ctx.getItemSlot(getConditionFieldLabel("COMPARE_DAMAGE", "amount")),
            condition.amount
        );
    }
}

const CONDITION_SPECS = {
    REQUIRE_GROUP: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_GROUP.displayName,
        read: readRequireGroup,
        write: writeRequireGroup,
    },
    COMPARE_VAR: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_VAR.displayName,
        write: writeCompareVar,
    },
    REQUIRE_PERMISSION: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_PERMISSION.displayName,
        write: writeRequirePermission,
    },
    IS_IN_REGION: {
        displayName: CONDITION_LORE_MAPPINGS.IS_IN_REGION.displayName,
        write: writeIsInRegion,
    },
    REQUIRE_ITEM: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_ITEM.displayName,
        write: writeRequireItem,
    },
    IS_DOING_PARKOUR: {
        displayName: CONDITION_LORE_MAPPINGS.IS_DOING_PARKOUR.displayName,
    },
    REQUIRE_POTION_EFFECT: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_POTION_EFFECT.displayName,
        write: writeRequirePotionEffect,
    },
    IS_SNEAKING: {
        displayName: CONDITION_LORE_MAPPINGS.IS_SNEAKING.displayName,
    },
    IS_FLYING: {
        displayName: CONDITION_LORE_MAPPINGS.IS_FLYING.displayName,
    },
    COMPARE_HEALTH: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_HEALTH.displayName,
        write: writeCompareHealth,
    },
    COMPARE_MAX_HEALTH: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_MAX_HEALTH.displayName,
        write: writeCompareMaxHealth,
    },
    COMPARE_HUNGER: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_HUNGER.displayName,
        write: writeCompareHunger,
    },
    REQUIRE_GAMEMODE: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_GAMEMODE.displayName,
        write: writeRequireGamemode,
    },
    COMPARE_PLACEHOLDER: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_PLACEHOLDER.displayName,
        write: writeComparePlaceholder,
    },
    REQUIRE_TEAM: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_TEAM.displayName,
        write: writeRequireTeam,
    },
    DAMAGE_CAUSE: {
        displayName: CONDITION_LORE_MAPPINGS.DAMAGE_CAUSE.displayName,
        write: writeDamageCause,
    },
    PVP_ENABLED: {
        displayName: CONDITION_LORE_MAPPINGS.PVP_ENABLED.displayName,
    },
    FISHING_ENVIRONMENT: {
        displayName: CONDITION_LORE_MAPPINGS.FISHING_ENVIRONMENT.displayName,
        write: writeFishingEnvironment,
    },
    PORTAL_TYPE: {
        displayName: CONDITION_LORE_MAPPINGS.PORTAL_TYPE.displayName,
        write: writePortalType,
    },
    BLOCK_TYPE: {
        displayName: CONDITION_LORE_MAPPINGS.BLOCK_TYPE.displayName,
        write: writeBlockType,
    },
    IS_ITEM: {
        displayName: CONDITION_LORE_MAPPINGS.IS_ITEM.displayName,
        write: writeIsItem,
    },
    COMPARE_DAMAGE: {
        displayName: CONDITION_LORE_MAPPINGS.COMPARE_DAMAGE.displayName,
        write: writeCompareDamage,
    },
} satisfies ConditionSpecMap;

function isConditionListItemInverted(slot: ItemSlot): boolean {
    return slot
        .getItem()
        .getLore()
        .some((line) => removedFormatting(line).trim() === "Inverted");
}

export type ReadConditionListOptions = {
    itemRegistry?: ItemRegistry;
};

export async function readConditionList(
    ctx: TaskContext,
    options?: ReadConditionListOptions
): Promise<ObservedConditionSlot[]> {
    await goToConditionPage(ctx, 1);
    const observed: ObservedConditionSlot[] = [];

    while (true) {
        const pageObserved = await readConditionsListPage(ctx);

        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }

        if (!getCurrentConditionPageState(ctx).hasNext) {
            break;
        }

        clickPaginatedNextPage(ctx);
        await waitForMenu(ctx);
    }

    await goToConditionPage(ctx, 1);
    canonicalizeObservedConditionSlots(observed, options?.itemRegistry);
    return observed;
}

async function writeOpenCondition(
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

function canonicalizeObservedConditionSlots(
    observed: readonly ObservedConditionSlot[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const entry of observed) {
        if (entry.condition !== null) {
            canonicalizeConditionItemName(entry.condition, itemRegistry);
        }
    }
}

export function canonicalizeObservedConditionItemNames(
    conditions: readonly (Condition | null)[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const condition of conditions) {
        if (condition !== null) {
            canonicalizeConditionItemName(condition, itemRegistry);
        }
    }
}

function canonicalizeConditionItemName(
    condition: Condition,
    itemRegistry: ItemRegistry
): void {
    if (
        condition.type !== "REQUIRE_ITEM" &&
        condition.type !== "BLOCK_TYPE" &&
        condition.type !== "IS_ITEM"
    ) {
        return;
    }

    if (condition.itemName !== undefined) {
        condition.itemName = itemRegistry.canonicalizeObservedName(
            condition.itemName
        );
    }
}
async function deleteObservedCondition(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getConditionSlotAtIndex(ctx, index, listLength);
    slot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
}

function getInvertSlot(ctx: TaskContext): ItemSlot {
    return ctx.getItemSlot((slot) => {
        const name = removedFormatting(slot.getItem().getName()).trim().toLowerCase();
        return name === "invert" || name === "inverted";
    });
}

async function setOpenConditionInverted(
    ctx: TaskContext,
    desiredInverted: boolean,
    knownCurrentInverted?: boolean
): Promise<void> {
    const invertSlot = getInvertSlot(ctx);
    const currentInverted = knownCurrentInverted ?? readBooleanValue(invertSlot) ?? false;

    if (currentInverted === desiredInverted) {
        return;
    }

    invertSlot.click();
    await waitForMenu(ctx);
}

export async function importCondition(
    ctx: TaskContext,
    condition: Condition,
    itemRegistry?: ItemRegistry
): Promise<void> {
    ctx.getItemSlot("Add Condition").click();
    await waitForMenu(ctx);

    const spec = getConditionSpec(condition.type);
    const slot = ctx.getItemSlot(spec.displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`
        );
    }

    slot.click();
    await waitForMenu(ctx);
    await writeOpenCondition(ctx, condition, undefined, itemRegistry);

    await setOpenConditionInverted(ctx, condition.inverted === true);
    // we ALWAYS click go back because every single condition has
    // the invert toggle so opens a submenu, this is not the case for actions
    await clickGoBack(ctx);

    if (condition.note) {
        const conditionSlots = getVisibleConditionItemSlots(ctx);
        const addedSlot = conditionSlots[conditionSlots.length - 1];
        if (addedSlot) {
            await setListItemNote(ctx, addedSlot, condition.note);
        }
    }
}

async function applyConditionListDiff(
    ctx: TaskContext,
    observed: ObservedConditionSlot[],
    diff: ConditionListDiff,
    itemRegistry?: ItemRegistry
): Promise<void> {
    const currentObserved = [...observed];

    for (const entry of diff.edits) {
        const currentIndex = currentObserved.indexOf(entry.observed);
        if (currentIndex === -1) {
            continue;
        }

        const conditionSlot = await getConditionSlotAtIndex(
            ctx,
            currentIndex,
            currentObserved.length
        );
        entry.observed.slot = conditionSlot;
        entry.observed.slotId = conditionSlot.getSlotId();

        if (onlyNoteDiffers(entry.desired, entry.observed?.condition)) {
            await setListItemNote(ctx, conditionSlot, entry.desired.note);
            continue;
        }

        conditionSlot.click();
        await waitForMenu(ctx);

        if (!entry.observed.condition) {
            throw new Error(
                "Observed condition should always be present for edit operations."
            );
        }

        await writeOpenCondition(
            ctx,
            entry.desired,
            entry.observed.condition,
            itemRegistry
        );

        const currentInverted = entry.observed.condition.inverted === true;
        const desiredInverted = entry.desired.inverted === true;
        await setOpenConditionInverted(ctx, desiredInverted, currentInverted);

        await clickGoBack(ctx);

        await setListItemNote(ctx, conditionSlot, entry.desired.note);
    }

    const deletesDescending = [...diff.deletes].sort((a, b) => b.index - a.index);
    for (const observed of deletesDescending) {
        const index = currentObserved.indexOf(observed);
        if (index === -1) {
            continue;
        }

        await deleteObservedCondition(ctx, index, currentObserved.length);
        currentObserved.splice(index, 1);
    }

    for (const condition of diff.adds) {
        await importCondition(ctx, condition, itemRegistry);
    }
}

function logConditionSyncState(ctx: TaskContext, diff: ConditionListDiff): void {
    const totalOps = diff.edits.length + diff.deletes.length + diff.adds.length;

    if (totalOps === 0) {
        ctx.displayMessage(`&7[cond-sync] &aUp to date.`);
        return;
    }

    ctx.displayMessage(`&7[cond-sync] &d${totalOps} operation(s):`);
    for (const entry of diff.edits) {
        const observedName =
            entry.observed.condition === null
                ? "Unknown Condition"
                : CONDITION_LORE_MAPPINGS[entry.observed.condition.type].displayName;
        ctx.displayMessage(
            `&7  &6~ [${entry.observed.index}] ${observedName} &7-> &6${CONDITION_LORE_MAPPINGS[entry.desired.type].displayName}`
        );
    }
    for (const entry of diff.deletes) {
        const deleteName =
            entry.condition === null
                ? "Unknown Condition"
                : CONDITION_LORE_MAPPINGS[entry.condition.type].displayName;
        ctx.displayMessage(`&7  &c- [${entry.index}] ${deleteName}`);
    }
    for (const [index, entry] of diff.adds.entries()) {
        ctx.displayMessage(
            `&7  &a+ [${index}] ${CONDITION_LORE_MAPPINGS[entry.type].displayName}`
        );
    }
}

export type SyncConditionListOptions = {
    /**
     * Pre-read observed list to use instead of reading from the menu.
     * Mirrors `SyncActionListOptions.observed`.
     */
    observed?: ObservedConditionSlot[];
    itemRegistry?: ItemRegistry;
};

export type SyncConditionListResult = {
    usedObserved: ObservedConditionSlot[];
};

export async function syncConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options?: SyncConditionListOptions
): Promise<SyncConditionListResult> {
    const observed =
        options?.observed ??
        (await readConditionList(ctx, { itemRegistry: options?.itemRegistry }));
    canonicalizeObservedConditionSlots(observed, options?.itemRegistry);
    const diff = diffConditionList(observed, desired);
    logConditionSyncState(ctx, diff);

    await applyConditionListDiff(ctx, observed, diff, options?.itemRegistry);
    return { usedObserved: observed };
}
