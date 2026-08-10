import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { CanonicalizeItemName } from "../items/itemReferences";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    ACTION_MAPPINGS,
    getChildListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../fields/actionMappings";
import {
    CONDITION_MAPPINGS,
    tryGetConditionTypeFromDisplayName,
} from "../fields/conditionMappings";
import { canonicalizeItemFields } from "../items/canonicalizeFields";
import type { ActionHydrationPlan } from "./hydration/plan";
import type { ActionListTrust } from "./applyTrust";
import type {
    ChildListsToRead,
    ChildListSummaries,
    Observed,
    ObservedActionSlot,
} from "../observedActions";
import { observedNodesFromSlots } from "../observedActions";
import type { ListReadOptions } from "../context/actionReadContext";
import {
    matchObservedToDesired,
    type DesiredActionEntry,
} from "./diff/childListMatching";
import { applyActionListTrust } from "./applyTrust";
import {
    addItemCaptureEntries,
    addScalarHydrationEntries,
    actionHasItemFieldsToCapture,
    buildFullHydrationPlan,
    createActionHydrationPlan,
    scalarFieldsNeedingHydration,
} from "./hydration/plan";
import {
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
} from "../menus/paginatedList";
import type { SyncEventHandler } from "../syncEvents";
import { ActionPath, ActionListPath } from "../actionPath";
import { COST, exactHydrationPlanUnits, phaseUnitsTotal } from "../progress/costs";
import { ACTION_LIST_CONFIG } from "./listConfigs";

export type ActionListReadMode =
    | { kind: "full" }
    | { kind: "sync"; desired: readonly Action[]; trust?: ActionListTrust };

export type ActionListScan = {
    slots: ObservedActionSlot[];
    plan: ActionHydrationPlan;
    isRootList: boolean;
};

function readChildListSummaries(
    action: Observed,
    slot: ItemSlot
): { summaries: ChildListSummaries; childListsToRead: ChildListsToRead } {
    const childListFields = getChildListFields(action.type);
    const lore = slot.getItem().getLore();
    const summaries: ChildListSummaries = {};
    const childListsToRead: ChildListsToRead = new Set();
    const labels = new Set(childListFields.map((field) => field.label));

    for (const { label, prop, kind } of childListFields) {
        const itemTypes: Array<Action["type"] | Condition["type"] | "UNKNOWN"> = [];
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
                kind === "conditionList"
                    ? tryGetConditionTypeFromDisplayName(displayName)
                    : tryGetActionTypeFromDisplayName(displayName);
            itemTypes.push(type ?? "UNKNOWN");
        }

        if (kind === "conditionList") {
            summaries[prop] = itemTypes as Array<Condition["type"] | "UNKNOWN">;
        } else {
            summaries[prop] = itemTypes as Array<Action["type"] | "UNKNOWN">;
        }
        if (itemTypes.length === 0) {
            Object.assign(action, { [prop]: [] });
        } else {
            childListsToRead.add(prop);
        }
    }

    return { summaries, childListsToRead };
}

async function readActionsListPage(
    ctx: TaskContext,
    captureItems: boolean
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
                hydrated: false,
                truncatedFields: [],
                childListSummaries: {},
                childListsToRead: new Set(),
            };
            if (!entry.type) {
                return observed;
            }

            const action = parseActionListItem(entry.slot, entry.type);
            const childList = readChildListSummaries(action, entry.slot);
            const truncatedFields = scalarFieldsNeedingHydration(action);
            observed.action = action;
            observed.hydrated =
                childList.childListsToRead.size === 0 &&
                truncatedFields.length === 0 &&
                (!captureItems || !actionHasItemFieldsToCapture(action));
            observed.truncatedFields = truncatedFields;
            observed.childListSummaries = childList.summaries;
            observed.childListsToRead = childList.childListsToRead;
            return observed;
        });

    return observed;
}

export async function scanActionList(
    ctx: TaskContext,
    mode: ActionListReadMode,
    read: ListReadOptions
): Promise<ActionListScan> {
    const needsItemHydration =
        read.itemReadMode !== "sync" || read.itemFieldObservations !== undefined;
    const progress = read.progress;
    const events = read.events;
    const desiredTotal = mode.kind === "sync" ? Math.max(1, mode.desired.length) : 1;
    const phaseUnits = read.phaseUnits;
    let readCompletedUnits = 0;
    let observed: ObservedActionSlot[] = [];
    if (phaseUnits !== undefined) {
        progress?.({
            phase: "reading",
            completedUnits: 0,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: { completedUnits: 0, totalUnits: desiredTotal, parent: null },
        });
    }
    events?.emit({
        kind: "readStarted",
        listPath: read.listPath ?? ActionListPath.root(),
    });
    observed = await readPaginatedList(
        ctx,
        ACTION_LIST_CONFIG,
        () => readActionsListPage(ctx, needsItemHydration),
        ({ totalEntries, pagesRead }) => {
            readCompletedUnits = Math.max(0, pagesRead - 1) * COST.pageTurnWait;
            if (phaseUnits === undefined) return;
            phaseUnits.reading = readCompletedUnits;
            progress?.({
                phase: "reading",
                completedUnits: readCompletedUnits,
                totalUnits: phaseUnitsTotal(phaseUnits),
                phaseUnits: phaseUnits,
                sync: {
                    completedUnits: totalEntries,
                    totalUnits: Math.max(desiredTotal, totalEntries),
                    parent: null,
                },
            });
        }
    );
    if (phaseUnits !== undefined) phaseUnits.reading = readCompletedUnits;
    const isRootList = read.listPath === undefined;
    let plan: ActionHydrationPlan;
    let trustApplication:
        | {
              matches: Map<ObservedActionSlot, DesiredActionEntry>;
              trust: ActionListTrust;
          }
        | undefined;
    if (isRootList) {
        // Only the top-level read can encounter child-list-bearing
        // actions (CONDITIONAL/RANDOM). CONDITIONAL/RANDOM are disallowed
        // inside their own ifActions/elseActions/actions, so any child-list
        // read's hydration plan can only carry scalar truncation entries.
        // Skip the child-list plan computation entirely for child-list reads.
        if (mode.kind === "full") {
            plan = buildFullHydrationPlan(observed);
        } else {
            const matches = matchObservedToDesired(observed, mode.desired);
            plan = createActionHydrationPlan(matches);
            if (mode.trust !== undefined) {
                trustApplication = { matches, trust: mode.trust };
            }
        }
    } else {
        plan = new Map();
    }
    addScalarHydrationEntries(plan, observed);
    if (needsItemHydration) {
        addItemCaptureEntries(plan, observed);
    }
    if (trustApplication !== undefined) {
        applyActionListTrust(trustApplication.matches, plan, trustApplication.trust);
    }
    if (isRootList) {
        emitObservedSnapshot(observed, read.events);
    }
    if (phaseUnits !== undefined) {
        phaseUnits.reading = readCompletedUnits;
        phaseUnits.hydrating = exactHydrationPlanUnits(plan);
        progress?.({
            phase: "reading",
            completedUnits: phaseUnits.reading,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: {
                completedUnits: observed.length,
                totalUnits: Math.max(desiredTotal, observed.length),
                parent: null,
            },
            measuredTotalUnits: true,
        });
    }
    if (isRootList) {
        for (const entry of observed) {
            if (entry.action !== null && !plan.has(entry)) {
                events?.emit({
                    kind: "actionReadCompleted",
                    path: ActionPath.at(undefined, entry.index),
                    hydrated: false,
                });
            }
        }
    }
    return { slots: observed, plan, isRootList };
}

export function emitObservedSnapshot(
    observed: readonly ObservedActionSlot[],
    events?: SyncEventHandler
): void {
    if (events === undefined) return;
    try {
        events.emit({
            kind: "observedSnapshot",
            nodes: observedNodesFromSlots(observed),
        });
    } catch (_e) {
        // Preview-side rendering errors must never abort the importer.
    }
}

export function canonicalizeActionItemName(
    action: Observed | Action,
    canonicalizeItemName: CanonicalizeItemName
): void {
    canonicalizeItemFields(action, ACTION_MAPPINGS, canonicalizeItemName);

    // Only CONDITIONAL/RANDOM carry child lists, and their child actions
    // are guaranteed non-CONDITIONAL/non-RANDOM by spec — so the child
    // pass is one level deep, no recursion needed.
    for (const childListField of getChildListFields(action.type)) {
        const value = (action as Record<string, unknown>)[childListField.prop];
        if (!Array.isArray(value)) continue;
        const childMapping =
            childListField.kind === "conditionList"
                ? CONDITION_MAPPINGS
                : ACTION_MAPPINGS;
        for (const child of value) {
            if (child === null) continue;
            canonicalizeItemFields(
                child as { type: string },
                childMapping,
                canonicalizeItemName
            );
        }
    }
}
