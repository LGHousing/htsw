import type { Condition } from "htsw/types";

import TaskContext from "../../../tasks/context";
import { type ItemRegistry } from "../../../importables/itemRegistry";
import { canonicalizeItemFields } from "../../fields/canonicalizeItems";
import {
    captureItemFromOpenEditorField,
    type ItemCaptureRegistry,
} from "../../itemCapture";
import {
    CONDITION_MAPPINGS,
    getConditionScalarLoreFields,
    parseConditionListItem,
    tryGetConditionTypeFromDisplayName,
} from "../../fields/conditionMappings";
import { isTruncatableKind, looksTruncated } from "../../fields/loreParsing";
import type { ObservedConditionSlot } from "../../types";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
} from "../../gui/paginatedList";
import { timedWaitForMenu } from "../../gui/menuWait";
import { clickGoBack } from "../../gui/menuUtils";
import { CONDITION_LIST_CONFIG } from "./listConfig";
import { getConditionSpec, isConditionListItemInverted } from "./specs";
import { COST, phaseUnitsTotal, type PhaseUnits } from "../../progress/costs";
import type { ProgressHandler } from "../../progress/types";

async function readConditionsListPage(
    ctx: TaskContext
): Promise<ObservedConditionSlot[]> {
    return getVisiblePaginatedItemSlots(ctx)
        .filter((slot) => !isEmptyPaginatedPlaceholder(slot, CONDITION_LIST_CONFIG))
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

export type ReadConditionListOptions = {
    itemRegistry?: ItemRegistry;
    itemCaptures?: ItemCaptureRegistry;
    phaseUnits?: PhaseUnits;
    progress?: ProgressHandler;
};

export async function readConditionList(
    ctx: TaskContext,
    options?: ReadConditionListOptions
): Promise<ObservedConditionSlot[]> {
    const observed = await readPaginatedList(
        ctx,
        CONDITION_LIST_CONFIG,
        () => readConditionsListPage(ctx)
    );
    await hydrateScalarConditions(ctx, observed, options);
    await captureConditionItems(ctx, observed, options);
    await goToPaginatedListPage(ctx, 1, CONDITION_LIST_CONFIG);
    canonicalizeObservedConditionSlots(observed, options?.itemRegistry);
    return observed;
}

function canonicalizeObservedConditionSlots(
    observed: readonly ObservedConditionSlot[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) return;
    for (const entry of observed) {
        if (entry.condition !== null) {
            canonicalizeItemFields(entry.condition, CONDITION_MAPPINGS, itemRegistry);
        }
    }
}

const SCALAR_CONDITION_HYDRATION_UNITS = COST.menuClickWait + COST.goBackWait;

function shouldHydrateScalarCondition(condition: Condition): boolean {
    if (!getConditionSpec(condition.type).read) return false;
    const fields = getConditionScalarLoreFields(condition.type);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!isTruncatableKind(field.kind)) continue;
        const value = (condition as Record<string, unknown>)[field.prop];
        if (typeof value === "string" && looksTruncated(value)) return true;
    }
    if (condition.type === "COMPARE_VAR" && condition.holder?.type === "Team") {
        const team = condition.holder.team;
        if (typeof team === "string" && looksTruncated(team)) return true;
    }
    return false;
}

async function hydrateScalarConditions(
    ctx: TaskContext,
    observed: readonly ObservedConditionSlot[],
    options: ReadConditionListOptions | undefined
): Promise<void> {
    const entries: ObservedConditionSlot[] = [];
    for (const entry of observed) {
        if (entry.condition === null) continue;
        if (shouldHydrateScalarCondition(entry.condition)) entries.push(entry);
    }
    if (entries.length === 0) return;

    const phaseUnits = options?.phaseUnits;
    const progress = options?.progress;
    const totalHydrate = entries.length * SCALAR_CONDITION_HYDRATION_UNITS;
    if (phaseUnits !== undefined) phaseUnits.hydrating = totalHydrate;

    let completed = 0;
    let completedHydrateUnits = 0;
    const emit = (_label: string): void => {
        if (phaseUnits === undefined || progress === undefined) return;
        progress({
            phase: "hydrating",
            completedUnits: phaseUnits.reading + completedHydrateUnits,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: { completedUnits: completed, totalUnits: entries.length, parent: null },
        });
    };

    for (const entry of entries) {
        emit(`reading condition ${entry.condition?.type ?? ""}`);
        await hydrateScalarCondition(ctx, entry, observed.length);
        completed++;
        completedHydrateUnits += SCALAR_CONDITION_HYDRATION_UNITS;
        emit(`${completed}/${entries.length} conditions read`);
    }
}

async function hydrateScalarCondition(
    ctx: TaskContext,
    entry: ObservedConditionSlot,
    listLength: number
): Promise<void> {
    if (entry.condition === null) return;
    const note = entry.condition.note;
    const inverted = entry.condition.inverted;
    await goToPaginatedListPage(
        ctx,
        getPaginatedListPageForIndex(entry.index),
        CONDITION_LIST_CONFIG
    );
    const slot = await getPaginatedListSlotAtIndex(
        ctx,
        entry.index,
        listLength,
        CONDITION_LIST_CONFIG
    );
    entry.slot = slot;
    entry.slotId = slot.getSlotId();
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const spec = getConditionSpec(entry.condition.type);
    if (!spec.read) {
        await clickGoBack(ctx);
        return;
    }
    const refreshed = await spec.read(ctx);
    if (note) refreshed.note = note;
    if (inverted) refreshed.inverted = true;
    entry.condition = refreshed;
    await clickGoBack(ctx);
}

function getConditionItemFieldsForCapture(
    type: Condition["type"]
): Array<{ label: string; prop: string }> {
    const loreFields = CONDITION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; kind: string }
    >;
    const result: Array<{ label: string; prop: string }> = [];
    for (const label in loreFields) {
        if (loreFields[label].kind === "item") {
            result.push({ label, prop: loreFields[label].prop });
        }
    }
    return result;
}

async function captureConditionItems(
    ctx: TaskContext,
    observed: readonly ObservedConditionSlot[],
    options: ReadConditionListOptions | undefined
): Promise<void> {
    const registry = options?.itemCaptures;
    if (registry === undefined) return;

    const entries: ObservedConditionSlot[] = [];
    for (let i = 0; i < observed.length; i++) {
        const entry = observed[i];
        if (entry.condition === null) continue;
        if (getConditionItemFieldsForCapture(entry.condition.type).length > 0) {
            entries.push(entry);
        }
    }
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i++) {
        await captureConditionItemFields(ctx, entries[i], observed.length, registry);
    }
}

async function captureConditionItemFields(
    ctx: TaskContext,
    entry: ObservedConditionSlot,
    listLength: number,
    registry: ItemCaptureRegistry
): Promise<void> {
    if (entry.condition === null) return;
    await goToPaginatedListPage(
        ctx,
        getPaginatedListPageForIndex(entry.index),
        CONDITION_LIST_CONFIG
    );
    const slot = await getPaginatedListSlotAtIndex(
        ctx,
        entry.index,
        listLength,
        CONDITION_LIST_CONFIG
    );
    entry.slot = slot;
    entry.slotId = slot.getSlotId();
    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    try {
        const fields = getConditionItemFieldsForCapture(entry.condition.type);
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const displayName = (entry.condition as Record<string, unknown>)[field.prop];
            if (typeof displayName !== "string" || displayName.length === 0) continue;
            const captured = await captureItemFromOpenEditorField(
                ctx,
                field.label,
                registry,
                displayName
            );
            if (captured !== null) {
                (entry.condition as Record<string, unknown>)[field.prop] = captured;
            }
        }
    } finally {
        await clickGoBack(ctx);
    }
}
