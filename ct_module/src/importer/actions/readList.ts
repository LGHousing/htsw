import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import {
    clickGoBack,
    timedWaitForMenu,
} from "../gui/helpers";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    ACTION_MAPPINGS,
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../fields/actionMappings";
import {
    CONDITION_MAPPINGS,
    tryGetConditionTypeFromDisplayName,
} from "../fields/conditionMappings";
import { canonicalizeItemFields } from "../fields/canonicalizeItems";
import type {
    ActionListTrust,
    NestedHydrationPlan,
    NestedListProp,
    NestedPropsToRead,
    NestedSummaries,
    Observed,
    ObservedActionSlot,
} from "../types";
import type { ActionListProgressSink } from "../progress/types";
import { createNestedHydrationPlan } from "./hydrationPlan";
import { matchObservedToDesired } from "./nestedMatching";
import { applyActionListTrust } from "./trustHydration";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
} from "../gui/paginatedList";
import { getActiveDiffSink } from "../diffSink";
import {
    COST,
    hydrationEntryBudget,
    type ActionListPhaseBudget,
} from "../progress/costs";
import { withCurrentPhase } from "../progress/timing";
import { ACTION_LIST_CONFIG } from "./listConfig";
import { getActionSpec } from "../actions";
import { actionLogLabel } from "./log";

export type ActionListReadMode =
    | {
          kind: "full";
          itemRegistry?: ItemRegistry;
          onProgress?: ActionListProgressSink;
          phaseBudget?: ActionListPhaseBudget;
      }
    | {
          kind: "sync";
          desired: readonly Action[];
          itemRegistry?: ItemRegistry;
          trust?: ActionListTrust;
          onProgress?: ActionListProgressSink;
          phaseBudget?: ActionListPhaseBudget;
      };

function readNestedSummaries(
    action: Observed<Action>,
    slot: ItemSlot
): { summaries: NestedSummaries; propsToRead: NestedPropsToRead } {
    const nestedFields = getNestedListFields(action.type);
    const lore = slot.getItem().getLore();
    const summaries: NestedSummaries = {};
    const propsToRead: NestedPropsToRead = new Set();
    const labels = new Set(nestedFields.map((field) => field.label));

    for (const { label, prop } of nestedFields) {
        const itemTypes: string[] = [];
        let labelIndex = -1;
        for (let i = 0; i < lore.length; i++) {
            if (removedFormatting(lore[i]).trim() === label + ":") {
                labelIndex = i;
                break;
            }
        }

        if (labelIndex === -1) {
            continue;
        }

        for (let i = labelIndex + 1; i < lore.length; i++) {
            const text = removedFormatting(lore[i]).trim();
            if (text === "") break;
            if (text.startsWith("minecraft:") || text.startsWith("NBT:")) break;
            if (
                text === "Left Click to edit!" ||
                text === "Right Click to remove!" ||
                text === "Click to edit!" ||
                text.startsWith("Use shift ")
            ) {
                break;
            }
            if (text.endsWith(":") && labels.has(text.slice(0, -1))) {
                break;
            }
            if (!text.startsWith("- ")) {
                break;
            }

            const displayName = text.slice(2).trim();
            if (displayName === "None") {
                continue;
            }

            const type =
                prop === "conditions"
                    ? tryGetConditionTypeFromDisplayName(displayName)
                    : tryGetActionTypeFromDisplayName(displayName);
            itemTypes.push(type ?? "UNKNOWN");
        }

        summaries[prop as NestedListProp] = itemTypes;
        if (itemTypes.length === 0) {
            Object.assign(action, { [prop]: [] });
        } else {
            propsToRead.add(prop as NestedListProp);
        }
    }

    return { summaries, propsToRead };
}

async function readActionsListPage(
    ctx: TaskContext
): Promise<ObservedActionSlot[]> {
    const slots = getVisiblePaginatedItemSlots(ctx).filter(
        (slot) => !isEmptyPaginatedPlaceholder(slot, ACTION_LIST_CONFIG)
    );
    const observed: ObservedActionSlot[] = slots
        .map((slot) => ({
            slot,
            type: tryGetActionTypeFromDisplayName(slot.getItem().getName()),
        }))

        .map((entry, index) => {
            const observed: ObservedActionSlot = {
                index,
                slotId: entry.slot.getSlotId(),
                slot: entry.slot,
                action: null,
                nestedReadState: "none",
                nestedSummaries: {},
                nestedPropsToRead: new Set(),
            };
            if (!entry.type) {
                return observed;
            }

            const action = parseActionListItem(entry.slot, entry.type);
            const nested = readNestedSummaries(action, entry.slot);
            observed.action = action;
            observed.nestedReadState =
                getNestedListFields(action.type).length === 0 ? "none" : "summary";
            observed.nestedSummaries = nested.summaries;
            observed.nestedPropsToRead = nested.propsToRead;
            return observed;
        });

    return observed;
}

export async function readActionList(
    ctx: TaskContext,
    mode: ActionListReadMode = { kind: "full" }
): Promise<ObservedActionSlot[]> {
    const progress = mode.onProgress;
    const desiredTotal =
        mode.kind === "sync" ? Math.max(1, mode.desired.length) : 1;
    const phaseBudget = mode.phaseBudget;
    let readEstimatedCompleted = 0;
    let observed: ObservedActionSlot[] = [];
    await withCurrentPhase("reading", async () => {
        if (phaseBudget !== undefined) {
            progress?.({
                phase: "reading",
                phaseLabel: "reading housing state",
                unitCompleted: 0,
                unitTotal: desiredTotal,
                estimatedCompleted: 0,
                estimatedTotal: phaseBudget.total,
                etaConfidence: "rough",
                phaseBudget,
            });
        }
        getActiveDiffSink()?.phase("reading housing state");
        observed = await readPaginatedList(
            ctx,
            ACTION_LIST_CONFIG,
            () => readActionsListPage(ctx),
            ({ totalEntries, pagesRead }) => {
                readEstimatedCompleted = Math.max(0, pagesRead - 1) * COST.pageTurnWait;
                if (phaseBudget === undefined) return;
                if (readEstimatedCompleted > phaseBudget.readPart) {
                    phaseBudget.readPart = readEstimatedCompleted;
                    phaseBudget.total = recomputeTotal(phaseBudget);
                }
                progress?.({
                    phase: "reading",
                    phaseLabel: `${totalEntries} actions read`,
                    unitCompleted: totalEntries,
                    unitTotal: Math.max(desiredTotal, totalEntries),
                    estimatedCompleted: readEstimatedCompleted,
                    estimatedTotal: phaseBudget.total,
                    etaConfidence: "rough",
                    phaseBudget,
                });
            }
        );
        // Reading is done. Grow `phaseBudget.readPart` to the observed
        // cost when it exceeded estimate (one-way bump — never shrinks)
        // so the ETA never regresses for already-spent work. Decreases
        // are handled later via `phaseBudget.applyPart` getting refined
        // once `applyDiff` knows the real diff.
        if (phaseBudget !== undefined) {
            if (readEstimatedCompleted > phaseBudget.readPart) {
                phaseBudget.readPart = readEstimatedCompleted;
                phaseBudget.total = recomputeTotal(phaseBudget);
            }
        }
    });
    let plan: NestedHydrationPlan;
    if (mode.kind === "full") {
        plan = buildFullHydrationPlan(observed);
    } else {
        const matches = matchObservedToDesired(observed, mode.desired);
        plan = createNestedHydrationPlan(matches);
        if (mode.trust !== undefined) {
            applyActionListTrust(matches, plan, mode.trust);
        }
    }
    await withCurrentPhase("hydrating", async () => {
        addScalarHydrationEntries(plan, observed);
        await hydrateNestedActions(
            ctx,
            plan,
            observed.length,
            mode.itemRegistry,
            progress,
            phaseBudget
        );
        await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    });
    canonicalizeObservedActionItemNames(observed, mode.itemRegistry);
    return observed;
}

function recomputeTotal(b: ActionListPhaseBudget): number {
    return b.readPart + b.hydratePart + b.applyPart;
}

function addScalarHydrationEntries(
    plan: NestedHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null || plan.has(entry)) {
            continue;
        }

        if (shouldHydrateScalarAction(entry.action)) {
            plan.set(entry, new Set());
        }
    }
}

function shouldHydrateScalarAction(action: Observed<Action>): boolean {
    if (action.type === "MESSAGE") {
        return removedFormatting(action.message).trim().endsWith("...");
    }

    return false;
}

function buildFullHydrationPlan(
    observed: readonly ObservedActionSlot[]
): NestedHydrationPlan {
    const plan: NestedHydrationPlan = new Map();
    for (const entry of observed) {
        if (entry.nestedPropsToRead && entry.nestedPropsToRead.size > 0) {
            plan.set(entry, entry.nestedPropsToRead);
        }
    }
    return plan;
}

export function canonicalizeObservedActionItemNames(
    observed: readonly ObservedActionSlot[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, itemRegistry);
        }
    }
}

export function canonicalizeActionItemName(
    action: Observed<Action> | Action,
    itemRegistry: ItemRegistry
): void {
    canonicalizeItemFields(action, ACTION_MAPPINGS, itemRegistry);

    for (const nestedField of getNestedListFields(action.type)) {
        const value = (action as Record<string, unknown>)[nestedField.prop];
        if (!Array.isArray(value)) continue;
        for (const child of value) {
            if (child === null) continue;
            if (nestedField.prop === "conditions") {
                canonicalizeItemFields(
                    child as { type: string },
                    CONDITION_MAPPINGS,
                    itemRegistry
                );
            } else {
                canonicalizeActionItemName(child as Action, itemRegistry);
            }
        }
    }
}

async function hydrateNestedActions(
    ctx: TaskContext,
    plan: NestedHydrationPlan,
    listLength: number,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    phaseBudget?: ActionListPhaseBudget
): Promise<void> {
    let completed = 0;
    const total = plan.size;
    let completedBudget = 0;
    let totalBudget = 0;
    plan.forEach((propsToRead, entry) => {
        totalBudget += hydrationEntryBudget(entry, propsToRead);
    });
    if (phaseBudget !== undefined && totalBudget > phaseBudget.hydratePart) {
        phaseBudget.hydratePart = totalBudget;
        phaseBudget.total = recomputeTotal(phaseBudget);
    }
    const emit = (label: string) => {
        if (phaseBudget === undefined) return;
        progress?.({
            phase: "hydrating",
            phaseLabel: label,
            unitCompleted: completed,
            unitTotal: total,
            estimatedCompleted: phaseBudget.readPart + completedBudget,
            estimatedTotal: phaseBudget.total,
            etaConfidence: "informed",
            phaseBudget,
        });
    };
    for (const [entry, propsToRead] of plan) {
        emit(`reading nested ${actionLogLabel(entry.action)}`);
        getActiveDiffSink()?.phase(`reading nested ${actionLogLabel(entry.action)}`);
        const beforeBudget = hydrationEntryBudget(entry, propsToRead);
        await hydrateNestedAction(ctx, entry, propsToRead, listLength, itemRegistry);
        completedBudget += beforeBudget;
        completed++;
        emit(`${completed}/${total} nested actions read`);
    }
}

async function hydrateNestedAction(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number,
    itemRegistry?: ItemRegistry
): Promise<void> {
    if (entry.action === null) {
        return;
    }

    const note = entry.action.note;
    try {
        await goToPaginatedListPage(ctx, getPaginatedListPageForIndex(entry.index), ACTION_LIST_CONFIG);
        const actionSlot = await getPaginatedListSlotAtIndex(ctx, entry.index, listLength, ACTION_LIST_CONFIG);
        entry.slot = actionSlot;
        entry.slotId = actionSlot.getSlotId();

        actionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const spec = getActionSpec(entry.action.type);
        if (!spec.read) {
            throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
        }

        entry.action = await spec.read(ctx, propsToRead, itemRegistry);
        entry.nestedReadState = "full";
        if (note) {
            entry.action.note = note;
        }
        await clickGoBack(ctx);
    } catch (error) {
        ctx.displayMessage(
            `&7[action-read] &cFailed to read nested action at index ${entry.index} (${entry.action.type}): ${error}`
        );
        if (ctx.tryGetMenuItemSlot("Go Back") !== null) {
            await clickGoBack(ctx);
        }
    }
}
