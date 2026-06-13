import { Diagnostic } from "htsw";
import type { Condition } from "htsw/types";

import TaskContext from "../../../tasks/context";
import { type ItemRegistry } from "../../../importables/itemRegistry";
import {
    clickGoBack,
    isLimitExceeded,
    readBooleanValue,
    setListItemNote,
    setNoteOnLastVisibleSlot,
} from "../../gui/menuUtils";
import { timedWaitForMenu } from "../../gui/menuWait";
import { ItemSlot, MouseButton } from "../../../tasks/specifics/slots";
import { removedFormatting } from "../../../utils/helpers";
import { CONDITION_MAPPINGS } from "../../fields/conditionMappings";
import type {
    ConditionListDiff,
    ConditionListOperation,
    ObservedConditionSlot,
} from "../../types";
import type { ProgressHandler } from "../../progress/types";
import { getPaginatedListSlotAtIndex } from "../../gui/paginatedList";
import { CONDITION_LIST_CONFIG } from "./listConfig";
import { getConditionSpec, writeOpenCondition } from "./specs";
import {
    conditionListReadUnits,
    conditionListDiffApplyUnits,
    conditionOperationUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsTotal,
    type PhaseUnits,
} from "../../progress/costs";
import { traceConditionOp } from "../../progress/trace";
import { currentConditionListFromSlots, diffConditionList } from "./diff";
import { readConditionList } from "./readList";

export type ApplyConditionListOptions = {
    observed?: ObservedConditionSlot[];
    itemRegistry: ItemRegistry;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
};

export type ApplyConditionListResult = {
    usedObserved: ObservedConditionSlot[];
};

type LiveConditionListEntry = {
    entryId: number;
    condition: Condition | null;
};

function getInvertSlot(ctx: TaskContext): ItemSlot {
    return ctx.getMenuItemSlot((slot) => {
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
    await timedWaitForMenu(ctx, "menuClickWait");
}

async function importCondition(
    ctx: TaskContext,
    condition: Condition,
    itemRegistry: ItemRegistry
): Promise<void> {
    ctx.getMenuItemSlot("Add Condition").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getConditionSpec(condition.type);
    const slot = ctx.getMenuItemSlot(spec.displayName);

    if (isLimitExceeded(slot, "condition")) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`
        );
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    await writeOpenCondition(ctx, condition, undefined, itemRegistry);

    await setOpenConditionInverted(ctx, condition.inverted === true);
    await clickGoBack(ctx);

    await setNoteOnLastVisibleSlot(ctx, condition.note);
}

async function deleteObservedCondition(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(ctx, index, listLength, CONDITION_LIST_CONFIG);
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

function findCurrentConditionIndex(
    entries: readonly LiveConditionListEntry[],
    entryId: number
): number {
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].entryId === entryId) return i;
    }
    return -1;
}


export async function applyConditionListDiff(
    ctx: TaskContext,
    observed: ObservedConditionSlot[],
    diff: ConditionListDiff,
    itemRegistry: ItemRegistry,
    progress?: ProgressHandler,
    phaseUnits?: PhaseUnits
): Promise<void> {
    const currentEntries: LiveConditionListEntry[] = [];
    for (let i = 0; i < observed.length; i++) {
        currentEntries.push({
            entryId: i,
            condition: observed[i].condition,
        });
    }
    let nextRuntimeEntryId = observed.length;
    const edits: Array<Extract<ConditionListOperation, { kind: "edit" }>> = [];
    const deletes: Array<Extract<ConditionListOperation, { kind: "delete" }>> = [];
    const adds: Array<Extract<ConditionListOperation, { kind: "add" }>> = [];
    for (const op of diff.operations) {
        if (op.kind === "edit") edits.push(op);
        else if (op.kind === "delete") deletes.push(op);
        else adds.push(op);
    }

    let completedOps = 0;
    let completedUnits = 0;
    const totalOps = diff.operations.length;
    const plannedApplyUnits = conditionListDiffApplyUnits(diff);
    if (phaseUnits !== undefined) {
        phaseUnits.applying = plannedApplyUnits;
    }
    const baseline = phaseUnits === undefined
        ? 0
        : phaseUnits.reading + phaseUnits.hydrating;
    let lastLabel = "";
    const emitConditionOp = (label: string): void => {
        if (progress === undefined) return;
        if (totalOps === 0) return;
        lastLabel = label;
        progress({
            phase: "applying",
            completedUnits: baseline + completedUnits,
            totalUnits: phaseUnits === undefined
                ? plannedApplyUnits
                : phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits === undefined
                ? {
                      setup: 0,
                      reading: 0,
                      hydrating: 0,
                      applying: plannedApplyUnits,
                  }
                : phaseUnits,
            sync: { completedUnits: completedOps, totalUnits: totalOps, parent: null },
        });
    };

    if (totalOps === 0) {
        progress?.({
            phase: "applying",
            completedUnits: baseline + plannedApplyUnits,
            totalUnits: phaseUnits === undefined
                ? plannedApplyUnits
                : phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits === undefined
                ? {
                      setup: 0,
                      reading: 0,
                      hydrating: 0,
                      applying: plannedApplyUnits,
                  }
                : phaseUnits,
            sync: { completedUnits: 1, totalUnits: 1, parent: null },
        });
        return;
    }

    for (const op of edits) {
        const currentIndex = findCurrentConditionIndex(currentEntries, op.entryId);
        if (currentIndex === -1) {
            continue;
        }

        const observedName = CONDITION_MAPPINGS[op.baselineCondition.type].displayName;
        emitConditionOp(`edit condition ${observedName}`);
        traceConditionOp({
            opKind: op.noteOnly ? "noteOnly" : "edit",
            conditionType: op.desired.type,
            units: conditionOperationUnits(op),
            invertChanged:
                (op.baselineCondition.inverted === true) !==
                (op.desired.inverted === true),
        });

        const conditionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            currentEntries.length,
            CONDITION_LIST_CONFIG
        );

        if (op.noteOnly) {
            await setListItemNote(ctx, conditionSlot, op.desired.note);
            completedUnits += conditionOperationUnits(op);
            completedOps++;
            currentEntries[currentIndex].condition = op.desired;
            continue;
        }

        conditionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await writeOpenCondition(
            ctx,
            op.desired,
            op.baselineCondition,
            itemRegistry
        );

        const currentInverted = op.baselineCondition.inverted === true;
        const desiredInverted = op.desired.inverted === true;
        await setOpenConditionInverted(ctx, desiredInverted, currentInverted);

        await clickGoBack(ctx);

        await setListItemNote(ctx, conditionSlot, op.desired.note);
        completedUnits += conditionOperationUnits(op);
        completedOps++;
        currentEntries[currentIndex].condition = op.desired;
    }

    deletes.sort((a, b) => {
        const bIndex = findCurrentConditionIndex(currentEntries, b.entryId);
        const aIndex = findCurrentConditionIndex(currentEntries, a.entryId);
        return bIndex - aIndex;
    });
    for (const op of deletes) {
        const index = findCurrentConditionIndex(currentEntries, op.entryId);
        if (index === -1) {
            continue;
        }

        const observedName =
            op.baselineCondition === null
                ? "condition"
                : CONDITION_MAPPINGS[op.baselineCondition.type].displayName;
        emitConditionOp(`delete condition ${observedName}`);
        traceConditionOp({
            opKind: "delete",
            conditionType: op.baselineCondition?.type ?? "unknown",
            units: conditionOperationUnits(op),
        });

        await deleteObservedCondition(ctx, index, currentEntries.length);
        currentEntries.splice(index, 1);
        completedUnits += conditionOperationUnits(op);
        completedOps++;
    }

    for (const op of adds) {
        emitConditionOp(
            `add condition ${CONDITION_MAPPINGS[op.desired.type].displayName}`
        );
        traceConditionOp({
            opKind: "add",
            conditionType: op.desired.type,
            units: conditionOperationUnits(op),
        });
        await importCondition(ctx, op.desired, itemRegistry);
        currentEntries.push({
            entryId: nextRuntimeEntryId++,
            condition: op.desired,
        });
        completedUnits += conditionOperationUnits(op);
        completedOps++;
    }

    if (lastLabel.length > 0) emitConditionOp(lastLabel);
}

export async function applyConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options: ApplyConditionListOptions
): Promise<ApplyConditionListResult> {
    const phaseUnits = estimateConditionListPhaseUnits(
        desired,
        options.baselineCurrent
    );
    const progress = options.progress;
    progress?.({
        phase: "reading",
        completedUnits: 0,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 0, totalUnits: 1, parent: null },
    });
    const observed =
        options.observed ??
        (await readConditionList(ctx, {
            itemRegistry: options.itemRegistry,
            phaseUnits,
            progress,
        }));
    phaseUnits.reading = conditionListReadUnits(observed.length);
    progress?.({
        phase: "reading",
        completedUnits: phaseUnits.reading,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });
    const diff = diffConditionList(currentConditionListFromSlots(observed), desired);

    await applyConditionListDiff(
        ctx,
        observed,
        diff,
        options.itemRegistry,
        progress,
        phaseUnits
    );
    return { usedObserved: observed };
}

