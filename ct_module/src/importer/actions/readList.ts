import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import {
    clickGoBack,
    timedWaitForMenu,
} from "../helpers";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../actionMappings";
import { tryGetConditionTypeFromDisplayName } from "../conditionMappings";
import { canonicalizeObservedConditionItemNames } from "../conditions";
import type {
    ActionListProgressSink,
    ActionListReadMode,
    NestedHydrationPlan,
    NestedListProp,
    NestedPropsToRead,
    NestedSummaries,
    Observed,
    ObservedActionSlot,
} from "../types";
import { createNestedHydrationPlan } from "./hydrationPlan";
import { matchObservedToDesired } from "./nestedMatching";
import { applyActionListTrust } from "./trustHydration";
import {
    clickPaginatedNextPage,
    getCurrentPaginatedListPageState,
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
} from "../paginatedList";
import { getActiveDiffSink } from "../diffSink";
import { COST, actionListRoughBudget, hydrationEntryBudget } from "../progress/costs";
import { ACTION_LIST_CONFIG } from "./listConfig";
import { getActionSpec } from "../actions";
import { actionLogLabel } from "./log";

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

export async function readActionsListPage(
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
    const roughEstimate =
        mode.kind === "sync" ? Math.max(1, actionListRoughBudget(mode.desired)) : 1;
    let readEstimatedCompleted = 0;
    progress?.({
        phase: "reading",
        completed: 0,
        total: desiredTotal,
        label: "reading housing state",
        estimatedCompleted: 0,
        estimatedTotal: roughEstimate,
        confidence: "rough",
    });
    getActiveDiffSink()?.phase("reading housing state");
    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    const observed: ObservedActionSlot[] = [];

    while (true) {
        const pageObserved = await readActionsListPage(ctx);
        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }
        progress?.({
            phase: "reading",
            completed: observed.length,
            total: Math.max(desiredTotal, observed.length),
            label: `${observed.length} actions read`,
            estimatedCompleted: readEstimatedCompleted,
            estimatedTotal: Math.max(roughEstimate, readEstimatedCompleted),
            confidence: "rough",
        });

        const state = getCurrentPaginatedListPageState(ctx, ACTION_LIST_CONFIG);
        if (!state.hasNext) {
            break;
        }

        clickPaginatedNextPage(ctx);
        await timedWaitForMenu(ctx, "pageTurnWait");
        readEstimatedCompleted += COST.pageTurnWait;
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
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
    addScalarHydrationEntries(plan, observed);
    await hydrateNestedActions(ctx, plan, observed.length, mode.itemRegistry, progress, readEstimatedCompleted);
    canonicalizeObservedActionItemNames(observed, mode.itemRegistry);

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    return observed;
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
    if (
        action.type === "GIVE_ITEM" ||
        action.type === "REMOVE_ITEM" ||
        action.type === "DROP_ITEM"
    ) {
        if (action.itemName !== undefined) {
            action.itemName = itemRegistry.canonicalizeObservedName(action.itemName);
        }
    }

    if (action.type === "CONDITIONAL") {
        canonicalizeObservedConditionItemNames(action.conditions, itemRegistry);
        for (const nested of action.ifActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
            }
        }
        for (const nested of action.elseActions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
            }
        }
    }

    if (action.type === "RANDOM") {
        for (const nested of action.actions) {
            if (nested !== null) {
                canonicalizeActionItemName(nested, itemRegistry);
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
    baseEstimatedCompleted: number = 0
): Promise<void> {
    let completed = 0;
    const total = plan.size;
    let completedBudget = 0;
    let totalBudget = 0;
    plan.forEach((propsToRead, entry) => {
        totalBudget += hydrationEntryBudget(entry, propsToRead);
    });
    for (const [entry, propsToRead] of plan) {
        progress?.({
            phase: "hydrating",
            completed,
            total,
            label: `reading nested ${actionLogLabel(entry.action)}`,
            estimatedCompleted: baseEstimatedCompleted + completedBudget,
            estimatedTotal: baseEstimatedCompleted + totalBudget,
            confidence: "informed",
        });
        getActiveDiffSink()?.phase(`reading nested ${actionLogLabel(entry.action)}`);
        const beforeBudget = hydrationEntryBudget(entry, propsToRead);
        await hydrateNestedAction(ctx, entry, propsToRead, listLength, itemRegistry);
        completedBudget += beforeBudget;
        completed++;
        progress?.({
            phase: "hydrating",
            completed,
            total,
            label: `${completed}/${total} nested actions read`,
            estimatedCompleted: baseEstimatedCompleted + completedBudget,
            estimatedTotal: baseEstimatedCompleted + totalBudget,
            confidence: "informed",
        });
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
