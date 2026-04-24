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
import {
    CONDITION_LORE_MAPPINGS,
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

export { diffConditionList };

// Shape of Conditions w/ read & write methods
type ConditionSpec<T extends Condition> = {
    displayName: string;
    read?: (ctx: TaskContext) => Promise<T>;
    write?: (ctx: TaskContext, desired: T, current?: T) => Promise<void>;
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

const CONDITION_ITEMS_PER_PAGE = 21;
const CONDITION_PREV_PAGE_SLOT_ID = 45;
const CONDITION_NEXT_PAGE_SLOT_ID = 53;

function getVisibleConditionItemSlots(ctx: TaskContext): ItemSlot[] {
    const slots = ctx.getAllItemSlots((slot) => {
        const slotId = slot.getSlotId();
        const row = Math.floor(slotId / 9);
        const col = slotId % 9;
        return row >= 1 && row <= 3 && col >= 1 && col <= 7;
    });
    if (slots === null) {
        throw new Error("No open container found");
    }

    return slots.sort((a, b) => a.getSlotId() - b.getSlotId());
}

function isNoConditionsPlaceholder(slot: ItemSlot): boolean {
    return removedFormatting(slot.getItem().getName()).trim() === "No Conditions!";
}

function parsePaginatedConditionTitlePage(
    title: string
): { currentPage: number; totalPages: number } | null {
    const trimmedTitle = title.trim();
    const exactMatch = trimmedTitle.match(/^\((\d+)\/(\d+)\)\s+/);
    if (exactMatch) {
        const currentPage = Number(exactMatch[1]);
        const totalPages = Number(exactMatch[2]);
        if (
            !Number.isInteger(currentPage) ||
            !Number.isInteger(totalPages) ||
            currentPage < 1 ||
            totalPages < 1 ||
            currentPage > totalPages
        ) {
            throw new Error(`Invalid paginated condition title: "${title}"`);
        }
        return { currentPage, totalPages };
    }

    if (/\([^)]*\)\s*$/.test(trimmedTitle) || /^\([^)]*\)\s+/.test(trimmedTitle)) {
        throw new Error(`Malformed paginated condition title: "${title}"`);
    }

    return null;
}

function hasConditionNextPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === CONDITION_NEXT_PAGE_SLOT_ID) !==
        null
    );
}

function hasConditionPrevPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === CONDITION_PREV_PAGE_SLOT_ID) !==
        null
    );
}

function getCurrentConditionPageState(ctx: TaskContext): {
    currentPage: number;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
} {
    const title = ctx.getOpenContainerTitle();
    if (title === null) {
        throw new Error("No open container found");
    }

    const parsedTitle = parsePaginatedConditionTitlePage(title);
    const hasNext = hasConditionNextPage(ctx);
    if (parsedTitle === null) {
        return {
            currentPage: 1,
            totalPages: hasNext ? null : 1,
            hasNext,
            hasPrev: false,
        };
    }

    return {
        currentPage: parsedTitle.currentPage,
        totalPages: parsedTitle.totalPages,
        hasNext,
        hasPrev: hasConditionPrevPage(ctx),
    };
}

function getConditionPageForIndex(index: number): number {
    return Math.floor(index / CONDITION_ITEMS_PER_PAGE) + 1;
}

function getConditionLocalIndex(index: number): number {
    return index % CONDITION_ITEMS_PER_PAGE;
}

async function goToConditionPage(ctx: TaskContext, targetPage: number): Promise<void> {
    if (!Number.isInteger(targetPage) || targetPage < 1) {
        throw new Error(`Invalid target condition page: ${targetPage}`);
    }

    while (true) {
        const state = getCurrentConditionPageState(ctx);
        if (state.currentPage === targetPage) {
            return;
        }

        if (state.currentPage < targetPage) {
            if (!state.hasNext) {
                throw new Error(
                    `Cannot move to condition page ${targetPage}; no next page from ${state.currentPage}.`
                );
            }

            ctx.getItemSlot(
                (slot) => slot.getSlotId() === CONDITION_NEXT_PAGE_SLOT_ID
            ).click();
            await waitForMenu(ctx);

            const nextState = getCurrentConditionPageState(ctx);
            if (nextState.currentPage <= state.currentPage) {
                throw new Error(
                    "Condition page did not advance after clicking next page."
                );
            }
            continue;
        }

        if (!state.hasPrev) {
            throw new Error(
                `Cannot move to condition page ${targetPage}; no previous page from ${state.currentPage}.`
            );
        }

        ctx.getItemSlot(
            (slot) => slot.getSlotId() === CONDITION_PREV_PAGE_SLOT_ID
        ).click();
        await waitForMenu(ctx);

        const prevState = getCurrentConditionPageState(ctx);
        if (prevState.currentPage >= state.currentPage) {
            throw new Error(
                "Condition page did not go back after clicking previous page."
            );
        }
    }
}

async function getConditionSlotAtIndex(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<ItemSlot> {
    if (listLength <= 0 || index < 0 || index >= listLength) {
        throw new Error(
            `Condition index ${index} is out of bounds for list length ${listLength}.`
        );
    }

    await goToConditionPage(ctx, getConditionPageForIndex(index));
    const visibleSlots = getVisibleConditionItemSlots(ctx);
    const localIndex = getConditionLocalIndex(index);
    const slot = visibleSlots[localIndex];
    if (!slot) {
        throw new Error(
            `Could not resolve visible condition slot ${localIndex} for global index ${index}.`
        );
    }

    return slot;
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
    const includeHigherGroups =
        readBooleanValue(ctx.getItemSlot("Include Higher Groups")) ?? false;

    let group = readStringValue(ctx.getItemSlot("Required Group")) ?? undefined;
    if (!group) {
        await openSubmenu(ctx, "Required Group");
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
        await openSubmenu(ctx, "Required Group");

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
        ctx.getItemSlot("Include Higher Groups"),
        condition.includeHigherGroups === true
    );
}

async function writeCompareVar(
    ctx: TaskContext,
    condition: ConditionCompareVar
): Promise<void> {
    if (condition.holder) {
        await setCycleValue(ctx, "Holder", VAR_HOLDER_OPTIONS, condition.holder.type);
    }

    if (condition.var) {
        await setStringValue(ctx, ctx.getItemSlot("Variable"), condition.var);
    }

    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
    }

    if (condition.fallback) {
        await setStringValue(ctx, ctx.getItemSlot("Fallback Value"), condition.fallback);
    }
}

async function writeRequirePermission(
    ctx: TaskContext,
    condition: ConditionRequirePermission
): Promise<void> {
    if (condition.permission) {
        await setSelectValue(ctx, "Required Permission", condition.permission);
    }
}

async function writeIsInRegion(
    ctx: TaskContext,
    condition: ConditionIsInRegion
): Promise<void> {
    if (condition.region) {
        await setSelectValue(ctx, "Region", condition.region);
    }
}

async function writeRequireItem(
    ctx: TaskContext,
    condition: ConditionRequireItem
): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error(
            "Writing REQUIRE_ITEM item selection is not implemented yet."
        );
    }

    if (condition.whatToCheck) {
        await setCycleValue(
            ctx,
            "What To Check",
            ITEM_PROPERTY_OPTIONS,
            condition.whatToCheck
        );
    }

    if (condition.whereToCheck) {
        await setSelectValue(ctx, "Where To Check", condition.whereToCheck);
    }

    if (condition.amount) {
        await setCycleValue(
            ctx,
            "Required Amount",
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
        await setSelectValue(ctx, "Effect", condition.effect);
    }
}

async function writeCompareHealth(
    ctx: TaskContext,
    condition: ConditionCompareHealth
): Promise<void> {
    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
    }
}

async function writeCompareMaxHealth(
    ctx: TaskContext,
    condition: ConditionCompareMaxHealth
): Promise<void> {
    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
    }
}

async function writeCompareHunger(
    ctx: TaskContext,
    condition: ConditionCompareHunger
): Promise<void> {
    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
    }
}

async function writeRequireGamemode(
    ctx: TaskContext,
    condition: ConditionRequireGamemode
): Promise<void> {
    if (condition.gamemode) {
        await setCycleValue(
            ctx,
            "Required Gamemode",
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
        await setStringValue(ctx, ctx.getItemSlot("Placeholder"), condition.placeholder);
    }

    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
    }
}

async function writeRequireTeam(
    ctx: TaskContext,
    condition: ConditionRequireTeam
): Promise<void> {
    if (condition.team) {
        await setSelectValue(ctx, "Required Team", condition.team);
    }
}

async function writeDamageCause(
    ctx: TaskContext,
    condition: ConditionDamageCause
): Promise<void> {
    if (condition.cause) {
        await setSelectValue(ctx, "Cause", condition.cause);
    }
}

async function writeFishingEnvironment(
    ctx: TaskContext,
    condition: ConditionFishingEnvironment
): Promise<void> {
    if (condition.environment) {
        await setCycleValue(
            ctx,
            "Environment",
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
        await setSelectValue(ctx, "Type", condition.portalType);
    }
}

async function writeBlockType(
    _ctx: TaskContext,
    condition: ConditionBlockType
): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error(
            "Writing BLOCK_TYPE item selection is not implemented yet."
        );
    }
}

async function writeIsItem(_ctx: TaskContext, condition: ConditionIsItem): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error("Writing IS_ITEM item selection is not implemented yet.");
    }
}

async function writeCompareDamage(
    ctx: TaskContext,
    condition: ConditionCompareDamage
): Promise<void> {
    if (condition.op) {
        await setSelectValue(ctx, "Comparator", condition.op);
    }

    if (condition.amount) {
        await setStringValue(ctx, ctx.getItemSlot("Compare Value"), condition.amount);
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

export async function readConditionList(
    ctx: TaskContext
): Promise<ObservedConditionSlot[]> {
    await goToConditionPage(ctx, 1);
    const observed: ObservedConditionSlot[] = [];

    while (true) {
        const pageObserved = await readConditionsListPage(ctx);

        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }

        if (!hasConditionNextPage(ctx)) {
            break;
        }

        ctx.getItemSlot(
            (slot) => slot.getSlotId() === CONDITION_NEXT_PAGE_SLOT_ID
        ).click();
        await waitForMenu(ctx);
    }

    await goToConditionPage(ctx, 1);
    return observed;
}

async function writeOpenCondition(
    ctx: TaskContext,
    condition: Condition,
    current?: Condition
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
        await spec.write(ctx, condition, resolvedCurrent);
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
    condition: Condition
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
    await writeOpenCondition(ctx, condition);

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
    diff: ConditionListDiff
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

        await writeOpenCondition(ctx, entry.desired, entry.observed.condition);

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
        await importCondition(ctx, condition);
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

export async function syncConditionList(
    ctx: TaskContext,
    desired: Condition[]
): Promise<void> {
    const observed = await readConditionList(ctx);
    const diff = diffConditionList(observed, desired);
    logConditionSyncState(ctx, diff);

    await applyConditionListDiff(ctx, observed, diff);
}
