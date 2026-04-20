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
    normalizeNoteText,
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

// Shape of Conditions w/ read & write methods
type ConditionSpec<T extends Condition> = {
    displayName: string;
    read?: (ctx: TaskContext) => Promise<T>;
    write: (ctx: TaskContext, desired: T, current?: T) => Promise<void>;
};

type ConditionSpecMap = {
    [K in Condition["type"]]: ConditionSpec<Extract<Condition, { type: K }>>;
};

type ConditionListDiff = {
    edits: Array<{
        observed: ObservedCondition;
        desired: Condition;
    }>;
    deletes: ObservedCondition[];
    adds: Condition[];
}

type ObservedCondition = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    condition: Condition;
};

const VAR_HOLDER_OPTIONS = ["Player", "Global", "Team"] as const;
const GAMEMODE_OPTIONS = ["Adventure", "Survival", "Creative"] as const;
const FISHING_ENVIRONMENT_OPTIONS = ["Water", "Lava"] as const;
const ITEM_PROPERTY_OPTIONS = ["Item Type", "Metadata"] as const;
const ITEM_AMOUNT_OPTIONS = ["Any Amount", "Equal or Greater Amount"] as const;

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

function displayNameForSlot(slot: ItemSlot): string {
    return removedFormatting(slot.getItem().getName()).trim();
}

function normalizeForConditionCompare(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeForConditionCompare);
    }

    if (typeof value !== "object" || value === null) {
        return value;
    }

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
        const fieldValue = (value as Record<string, unknown>)[key];
        if (fieldValue !== undefined) {
            normalized[key] =
                key === "note" && typeof fieldValue === "string"
                    ? normalizeNoteText(fieldValue)
                    : normalizeForConditionCompare(fieldValue);
        }
    }

    return normalized;
}

function conditionsEqual(a: Condition, b: Condition): boolean {
    return (
        JSON.stringify(normalizeForConditionCompare(a)) ===
        JSON.stringify(normalizeForConditionCompare(b))
    );
}

// TODO: Optionally implement (in-menu) read functions for the rest of the conditons.
// This is NOT NECESSARY for conditions specifically because we can infer all data from the
// lore in the conditions list. Diff importer defaults to relying on the Condition object data
// passed in from the conditions list but can fallback to reading from the menu if read fxns are impl'd
async function readRequireGroup(
    ctx: TaskContext,
): Promise<ConditionRequireGroup> {
    const includeHigherGroups =
        readBooleanValue(ctx.getItemSlot("Include Higher Groups")) ?? false;

    let group = readStringValue(ctx.getItemSlot("Required Group")) ?? undefined;
    if (!group) {
        await openSubmenu(ctx, "Required Group");
        const selectedSlot = findMenuOptionByLore(ctx, "Already Selected");
        group = selectedSlot ? displayNameForSlot(selectedSlot) : undefined;
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

        const selectedSlot = findMenuOptionByLore(ctx, "Already Selected");
        const selectedGroup = selectedSlot ? displayNameForSlot(selectedSlot) : undefined;

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

    await setBooleanValue(
        ctx,
        ctx.getItemSlot("Include Higher Groups"),
        desiredIncludeHigherGroups,
    );
}

async function writeCompareVar(
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
    condition: ConditionRequirePermission,
): Promise<void> {
    if (condition.permission) {
        await setSelectValue(ctx, "Required Permission", condition.permission);
    }
}

async function writeIsInRegion(
    ctx: TaskContext,
    condition: ConditionIsInRegion,
): Promise<void> {
    if (condition.region) {
        await setSelectValue(ctx, "Region", condition.region);
    }
}

async function writeRequireItem(
    ctx: TaskContext,
    condition: ConditionRequireItem,
): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error(
            "Writing REQUIRE_ITEM item selection is not implemented yet.",
        );
    }

    if (condition.whatToCheck) {
        await setCycleValue(
            ctx,
            "What To Check",
            ITEM_PROPERTY_OPTIONS,
            condition.whatToCheck,
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
            condition.amount,
        );
    }
}

async function writeIsDoingParkour(
    _ctx: TaskContext,
    _condition: ConditionIsDoingParkour,
): Promise<void> {}

async function writeRequirePotionEffect(
    ctx: TaskContext,
    condition: ConditionRequirePotionEffect,
): Promise<void> {
    if (condition.effect) {
        await setSelectValue(ctx, "Effect", condition.effect);
    }
}

async function writeIsSneaking(
    _ctx: TaskContext,
    _condition: ConditionIsSneaking,
): Promise<void> {}

async function writeIsFlying(
    _ctx: TaskContext,
    _condition: ConditionIsFlying,
): Promise<void> {}

async function writeCompareHealth(
    ctx: TaskContext,
    condition: ConditionCompareHealth,
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
    condition: ConditionCompareMaxHealth,
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
    condition: ConditionCompareHunger,
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
    condition: ConditionRequireGamemode,
): Promise<void> {
    if (condition.gamemode) {
        await setCycleValue(
            ctx,
            "Required Gamemode",
            GAMEMODE_OPTIONS,
            condition.gamemode,
        );
    }
}

async function writeComparePlaceholder(
    ctx: TaskContext,
    condition: ConditionComparePlaceholder,
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
    condition: ConditionRequireTeam,
): Promise<void> {
    if (condition.team) {
        await setSelectValue(ctx, "Required Team", condition.team);
    }
}

async function writeDamageCause(
    ctx: TaskContext,
    condition: ConditionDamageCause,
): Promise<void> {
    if (condition.cause) {
        await setSelectValue(ctx, "Cause", condition.cause);
    }
}

async function writePvpEnabled(
    _ctx: TaskContext,
    _condition: ConditionPvpEnabled,
): Promise<void> {}

async function writeFishingEnvironment(
    ctx: TaskContext,
    condition: ConditionFishingEnvironment,
): Promise<void> {
    if (condition.environment) {
        await setCycleValue(
            ctx,
            "Environment",
            FISHING_ENVIRONMENT_OPTIONS,
            condition.environment,
        );
    }
}

async function writePortalType(
    ctx: TaskContext,
    condition: ConditionPortalType,
): Promise<void> {
    if (condition.portalType) {
        await setSelectValue(ctx, "Type", condition.portalType);
    }
}

async function writeBlockType(
    _ctx: TaskContext,
    condition: ConditionBlockType,
): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error(
            "Writing BLOCK_TYPE item selection is not implemented yet.",
        );
    }
}

async function writeIsItem(
    _ctx: TaskContext,
    condition: ConditionIsItem,
): Promise<void> {
    if (condition.itemName) {
        throw Diagnostic.error(
            "Writing IS_ITEM item selection is not implemented yet.",
        );
    }
}

async function writeCompareDamage(
    ctx: TaskContext,
    condition: ConditionCompareDamage,
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
        write: writeIsDoingParkour,
    },
    REQUIRE_POTION_EFFECT: {
        displayName: CONDITION_LORE_MAPPINGS.REQUIRE_POTION_EFFECT.displayName,
        write: writeRequirePotionEffect,
    },
    IS_SNEAKING: {
        displayName: CONDITION_LORE_MAPPINGS.IS_SNEAKING.displayName,
        write: writeIsSneaking,
    },
    IS_FLYING: {
        displayName: CONDITION_LORE_MAPPINGS.IS_FLYING.displayName,
        write: writeIsFlying,
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
        write: writePvpEnabled,
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
    ctx: TaskContext,
): Promise<ObservedCondition[]> {
    const slots = ctx.getAllItemSlots();
    if (slots === null) {
        throw new Error("No open container found");
    }

    const conditions: ObservedCondition[] = slots
        .map((slot) => ({
            slot,
            type: tryGetConditionTypeFromDisplayName(slot.getItem().getName()),
        }))
        .filter(
            (entry): entry is { slot: ItemSlot; type: Condition["type"] } =>
                entry.type !== undefined,
        )
        .map((entry, index) => {
            const condition = parseConditionListItem(entry.slot, entry.type);

            if (isConditionListItemInverted(entry.slot)) {
                condition.inverted = true;
            }

            return {
                index,
                slotId: entry.slot.getSlotId(),
                slot: entry.slot,
                condition,
            };
        });

    return conditions;
}

export function diffConditionList(
    observed: ObservedCondition[],
    desired: Condition[],
): ConditionListDiff {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = [...desired];
    const edits: ConditionListDiff["edits"] = [];
    const adds: Condition[] = [];

    // Remove matching conditions
    for (let desiredIndex = unmatchedDesired.length - 1; desiredIndex >= 0; desiredIndex--) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            conditionsEqual(entry.condition, desiredCondition),
        );

        if (observedIndex === -1) {
            continue;
        }

        unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
    }

    for (const desiredCondition of unmatchedDesired) {
        const observedIndex = unmatchedObserved.findIndex(
            (entry) => entry.condition.type === desiredCondition.type,
        );

        if (observedIndex === -1) {
            adds.push(desiredCondition);
            continue;
        }

        const [observedCondition] = unmatchedObserved.splice(observedIndex, 1);
        edits.push({
            observed: observedCondition,
            desired: desiredCondition,
        });
    }

    return {
        edits,
        deletes: unmatchedObserved,
        adds,
    };
}

async function openObservedCondition(
    observed: ObservedCondition,
    ctx: TaskContext,
): Promise<void> {
    observed.slot.click();
    await waitForMenu(ctx);
}

async function deleteObservedCondition(
    observed: ObservedCondition,
    ctx: TaskContext,
): Promise<void> {
    observed.slot.click(MouseButton.RIGHT);
    await waitForMenu(ctx);
}

function getInvertSlot(ctx: TaskContext): ItemSlot {
    return ctx.getItemSlot((slot) => {
        const name = removedFormatting(slot.getItem().getName())
            .trim()
            .toLowerCase();
        return name === "invert" || name === "inverted";
    });
}

async function setOpenConditionInverted(
    ctx: TaskContext,
    desiredInverted: boolean,
    knownCurrentInverted?: boolean,
): Promise<void> {
    const invertSlot = getInvertSlot(ctx);
    const currentInverted =
        knownCurrentInverted ?? readBooleanValue(invertSlot) ?? false;

    if (currentInverted === desiredInverted) {
        return;
    }

    invertSlot.click();
    await waitForMenu(ctx);
}



async function selectConditionType(
    ctx: TaskContext,
    type: Condition["type"],
): Promise<void> {
    const spec = getConditionSpec(type);
    const slot = ctx.getItemSlot(spec.displayName);

    if (isLimitExceeded(slot)) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`,
        );
    }

    slot.click();
    await waitForMenu(ctx);
}

// Writes the fields for the condition editor that is currently open.
async function writeOpenCondition(
    ctx: TaskContext,
    condition: Condition,
    current?: Condition,
): Promise<void> {
    const spec = getConditionSpec(condition.type);

    let resolvedCurrent = current;

    if (resolvedCurrent === undefined && spec.read) {
        resolvedCurrent = await spec.read(ctx);
    }

    await (spec.write as (ctx: TaskContext, desired: Condition, current?: Condition) => Promise<void>)(
        ctx, condition, resolvedCurrent,
    );

    if (condition.note) {
        await setStringValue(
            ctx,
            ctx.getItemSlot("Note"),
            normalizeNoteText(condition.note),
        );
    }
}

export async function readOpenCondition(
    ctx: TaskContext,
    type: Condition["type"],
): Promise<Condition> {
    const spec = getConditionSpec(type);
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

    await selectConditionType(ctx, condition.type);
    await writeOpenCondition(ctx, condition);

    await setOpenConditionInverted(ctx, condition.inverted === true);
    await clickGoBack(ctx);
}

async function applyConditionListDiff(
    ctx: TaskContext,
    diff: ConditionListDiff,
): Promise<void> {
    for (const entry of diff.edits) {
        await openObservedCondition(entry.observed, ctx);
        await writeOpenCondition(
            ctx,
            entry.desired,
            entry.observed.condition,
        );

        const currentInverted = entry.observed.condition.inverted === true;
        const desiredInverted = entry.desired.inverted === true;
        await setOpenConditionInverted(
            ctx,
            desiredInverted,
            currentInverted,
        );

        await clickGoBack(ctx);
    }

    const deletesDescending = [...diff.deletes].sort(
        (a, b) => b.index - a.index,
    );
    for (const observed of deletesDescending) {
        await deleteObservedCondition(observed, ctx);
    }

    for (const condition of diff.adds) {
        await importCondition(ctx, condition);
    }
}

function formatConditionSummary(condition: Condition): string {
    const spec = getConditionSpec(condition.type);
    const fields = JSON.stringify(condition);
    return `${spec.displayName} [${condition.type}] ${fields}`;
}

export async function syncConditionList(
    ctx: TaskContext,
    desired: Condition[],
): Promise<void> {
    const observed = await readConditionList(ctx);

    ctx.displayMessage(`&7[cond-sync] &eObserved ${observed.length} condition(s):`);
    for (const entry of observed) {
        ctx.displayMessage(`&7  [${entry.index}] &e${formatConditionSummary(entry.condition)}`);
    }
    ctx.displayMessage(`&7[cond-sync] &bDesired ${desired.length} condition(s):`);
    for (let i = 0; i < desired.length; i++) {
        ctx.displayMessage(`&7  [${i}] &b${formatConditionSummary(desired[i])}`);
    }

    const diff = diffConditionList(observed, desired);

    ctx.displayMessage(`&7[cond-sync] &dDiff: ${diff.edits.length} edit(s), ${diff.deletes.length} delete(s), ${diff.adds.length} add(s)`);
    for (const entry of diff.edits) {
        ctx.displayMessage(`&7  &6[EDIT] ${formatConditionSummary(entry.observed.condition)} &7-> &6${formatConditionSummary(entry.desired)}`);
    }
    for (const entry of diff.deletes) {
        ctx.displayMessage(`&7  &c[DELETE] ${formatConditionSummary(entry.condition)}`);
    }
    for (const entry of diff.adds) {
        ctx.displayMessage(`&7  &a[ADD] ${formatConditionSummary(entry)}`);
    }

    await applyConditionListDiff(ctx, diff);
}
