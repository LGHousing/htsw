import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ItemRegistry } from "../../importables/itemRegistry";
import { clickGoBack } from "../menus/menuUtils";
import { timedWaitForMenu } from "../menus/menuWait";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    ACTION_MAPPINGS,
    getActionLoreFields,
    getActionScalarLoreFields,
    getChildListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../fields/actionMappings";
import { captureItemFromOpenEditorField } from "../itemCapture";
import { isTaskCancelled } from "../../tasks/manager";
import { refreshTruncatedScalarFields } from "./readers";
import { isTruncatableKind, looksTruncated } from "../fields/loreParsing";
import {
    CONDITION_MAPPINGS,
    tryGetConditionTypeFromDisplayName,
} from "../fields/conditionMappings";
import { canonicalizeItemFields } from "../fields/canonicalizeItems";
import type {
    ActionHydrationPlan,
    ActionHydrationWork,
    ActionListTrust,
    ActionScalarFieldToRead,
    ChildListName,
    ChildListsToRead,
    ChildListSummaries,
    Observed,
    ObservedActionSlot,
    ListReadOptions,
} from "../types";
import {
    createActionHydrationPlan,
    matchObservedToDesired,
} from "./childListMatching";
import { applyActionListTrust } from "./applyTrust";
import {
    addItemFieldsToCapture,
    addScalarFieldsToRead,
    createActionHydrationWork,
} from "./hydrationPlan";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
} from "../menus/paginatedList";
import type { ActionPath, SyncEventHandler } from "../syncEvents";
import { actionPathForIndex, actionPathKey } from "../syncEvents";
import {
    COST,
    hydrationEntryUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import {
    createHydrationEntryAccount,
    type HydrationEntryAccount,
} from "../progress/hydrationAccount";
import type { ProgressPayload } from "../progress/types";
import { ACTION_LIST_CONFIG } from "./listConfigs";
import { getActionSpec } from "./specs";
import { createActionReadContext } from "../context/actionReadContext";
import { readConditionList } from "./conditions/readList";

export type ActionListReadMode =
    | { kind: "deep" }
    | { kind: "sync"; desired: readonly Action[]; trust?: ActionListTrust };

function readChildListSummaries(
    action: Observed<Action>,
    slot: ItemSlot
): { summaries: ChildListSummaries; childListsToRead: ChildListsToRead } {
    const childListFields = getChildListFields(action.type);
    const lore = slot.getItem().getLore();
    const summaries: ChildListSummaries = {};
    const childListsToRead: ChildListsToRead = new Set();
    const labels = new Set(childListFields.map((field) => field.label));

    for (const { label, prop } of childListFields) {
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

        summaries[prop as ChildListName] = itemTypes;
        if (itemTypes.length === 0) {
            Object.assign(action, { [prop]: [] });
        } else {
            childListsToRead.add(prop as ChildListName);
            // Seed one null per item so the preview can show the count
            // ("...3 conditions..." / "...3 actions...") before hydration
            // fills the real entries in. Guarded so a field the parser
            // already populated as an array isn't clobbered.
            if (!Array.isArray((action as Record<string, unknown>)[prop])) {
                Object.assign(action, { [prop]: itemTypes.map(() => null) });
            }
        }
    }

    return { summaries, childListsToRead };
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
                childListReadState: "none",
                childListSummaries: {},
                childListsToRead: new Set(),
            };
            if (!entry.type) {
                return observed;
            }

            const action = parseActionListItem(entry.slot, entry.type);
            const childList = readChildListSummaries(action, entry.slot);
            observed.action = action;
            observed.childListReadState =
                getChildListFields(action.type).length === 0 ? "none" : "shallow";
            observed.childListSummaries = childList.summaries;
            observed.childListsToRead = childList.childListsToRead;
            return observed;
        });

    return observed;
}

export async function readActionList(
    ctx: TaskContext,
    mode: ActionListReadMode = { kind: "deep" },
    read?: ListReadOptions
): Promise<ObservedActionSlot[]> {
    const progress = read?.progress;
    const events = read?.events;
    const desiredTotal =
        mode.kind === "sync" ? Math.max(1, mode.desired.length) : 1;
    const phaseUnits = read?.phaseUnits;
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
        listPath: read?.listPath === undefined ? "actions" : actionPathKey(read.listPath),
    });
    observed = await readPaginatedList(
        ctx,
        ACTION_LIST_CONFIG,
        () => readActionsListPage(ctx),
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
    const isTopLevelRead = read?.listPath === undefined;
    if (isTopLevelRead) {
        emitObservedSnapshot(observed, events);
    }
    let plan: ActionHydrationPlan;
    if (isTopLevelRead) {
        // Only the top-level read can encounter child-list-bearing
        // actions (CONDITIONAL/RANDOM). CONDITIONAL/RANDOM are disallowed
        // inside their own ifActions/elseActions/actions, so any child-list
        // read's hydration plan can only carry scalar truncation entries.
        // Skip the child-list plan computation entirely for child-list reads.
        if (mode.kind === "deep") {
            plan = buildFullHydrationPlan(observed);
        } else {
            const matches = matchObservedToDesired(observed, mode.desired);
            plan = createActionHydrationPlan(matches);
            if (mode.trust !== undefined) {
                applyActionListTrust(matches, plan, mode.trust);
            }
        }
    } else {
        plan = new Map();
    }
    addScalarHydrationEntries(plan, observed);
    if (read?.itemCaptures !== undefined) {
        addItemCaptureEntries(plan, observed);
    }
    await hydrateActionDetails(
        ctx,
        plan,
        observed,
        isTopLevelRead,
        read
    );
    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    if (read?.itemRegistry !== undefined) {
        for (const entry of observed) {
            if (entry.action !== null) {
                canonicalizeActionItemName(entry.action, read.itemRegistry);
            }
        }
    }
    if (isTopLevelRead) {
        emitObservedSnapshot(observed, events);
    }
    return observed;
}

function emitObservedSnapshot(
    observed: readonly ObservedActionSlot[],
    events?: SyncEventHandler
): void {
    if (events === undefined) return;
    const snapshot: Array<Action | null> = [];
    for (const entry of observed) {
        snapshot.push(entry.action as Action | null);
    }
    try {
        events.emit({ kind: "observedSnapshot", actions: snapshot });
    } catch (_e) {
        // Preview-side rendering errors must never abort the importer.
    }
}

function addScalarHydrationEntries(
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null) continue;

        addScalarFieldsToRead(
            plan,
            entry,
            scalarFieldsNeedingHydration(entry.action)
        );
    }
}

function getItemFieldsForCapture(
    actionType: Action["type"]
): Array<{ label: string; prop: string }> {
    const loreFields = getActionLoreFields(actionType);
    const result: Array<{ label: string; prop: string }> = [];
    for (const label in loreFields) {
        if (loreFields[label].kind === "item") {
            result.push({ label: label, prop: loreFields[label].prop });
        }
    }
    return result;
}

function addItemCaptureEntries(
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null) continue;
        addItemFieldsToCapture(plan, entry, getItemFieldsForCapture(entry.action.type));
    }
}

function scalarFieldsNeedingHydration(
    action: Observed<Action>
): ActionScalarFieldToRead[] {
    const fields = getActionScalarLoreFields(action.type);
    const out: ActionScalarFieldToRead[] = [];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!isTruncatableKind(field.kind)) continue;
        const value = (action as Record<string, unknown>)[field.prop];
        if (typeof value === "string" && looksTruncated(value)) {
            out.push(field);
            continue;
        }
        if (
            field.kind === "location" &&
            typeof value === "object" &&
            value !== null &&
            (value as { type?: unknown }).type === "Custom Coordinates"
        ) {
            const coord = (value as { value?: unknown }).value;
            if (typeof coord === "string" && looksTruncated(coord)) {
                out.push(field);
            }
        }
    }
    if (action.type === "CHANGE_VAR" && action.holder?.type === "Team") {
        const team = action.holder.team;
        if (typeof team === "string" && looksTruncated(team)) {
            for (let i = 0; i < fields.length; i++) {
                if (fields[i].prop === "holder") {
                    out.push(fields[i]);
                    break;
                }
            }
        }
    }
    return out;
}

function buildFullHydrationPlan(
    observed: readonly ObservedActionSlot[]
): ActionHydrationPlan {
    const plan: ActionHydrationPlan = new Map();
    for (const entry of observed) {
        if (entry.childListsToRead && entry.childListsToRead.size > 0) {
            plan.set(entry, createActionHydrationWork(entry.childListsToRead));
        }
    }
    return plan;
}

export function canonicalizeActionItemName(
    action: Observed<Action> | Action,
    itemRegistry: ItemRegistry
): void {
    canonicalizeItemFields(action, ACTION_MAPPINGS, itemRegistry);

    // Only CONDITIONAL/RANDOM carry child lists, and their child actions
    // are guaranteed non-CONDITIONAL/non-RANDOM by spec — so the child
    // pass is one level deep, no recursion needed.
    for (const childListField of getChildListFields(action.type)) {
        const value = (action as Record<string, unknown>)[childListField.prop];
        if (!Array.isArray(value)) continue;
        const childMapping =
            childListField.prop === "conditions" ? CONDITION_MAPPINGS : ACTION_MAPPINGS;
        for (const child of value) {
            if (child === null) continue;
            canonicalizeItemFields(
                child as { type: string },
                childMapping,
                itemRegistry
            );
        }
    }
}

async function hydrateActionDetails(
    ctx: TaskContext,
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[],
    isTopLevelRead: boolean = false,
    read?: ListReadOptions
): Promise<void> {
    const progress = read?.progress;
    const phaseUnits = read?.phaseUnits;
    const events = read?.events;
    const listPath = read?.listPath;
    let completed = 0;
    const total = plan.size;
    let completedHydrateUnits = 0;
    let totalHydrateUnits = 0;
    plan.forEach((work, entry) => {
        totalHydrateUnits += hydrationEntryUnits(entry, work);
    });
    if (phaseUnits !== undefined) phaseUnits.hydrating = totalHydrateUnits;
    // The running entry's account replaces its lump-sum estimate with what
    // its child reads actually establish, payload by payload — `emit` folds
    // the live delta into the hydrate totals so the caller sees plan-derived
    // units the moment a child read builds its plan, not when the entry ends.
    let currentAccount: HydrationEntryAccount | null = null;
    let currentEntryEstimate = 0;
    const emit = () => {
        if (phaseUnits === undefined) return;
        const entryDelta =
            currentAccount === null
                ? 0
                : currentAccount.bookedUnits() - currentEntryEstimate;
        const entryCompleted =
            currentAccount === null ? 0 : currentAccount.completedUnits();
        phaseUnits.hydrating = totalHydrateUnits + entryDelta;
        progress?.({
            phase: "hydrating",
            completedUnits:
                phaseUnits.reading + completedHydrateUnits + entryCompleted,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: { completedUnits: completed, totalUnits: total, parent: null },
        });
    };
    const subStepSnapshot =
        isTopLevelRead && events !== undefined
            ? () => emitObservedSnapshot(observed, events)
            : undefined;
    for (const [entry, work] of plan) {
        const entryPath = actionPathForIndex(listPath, entry.index);
        currentEntryEstimate = hydrationEntryUnits(entry, work);
        currentAccount = createHydrationEntryAccount(entry, work, emit);
        emit();
        events?.emit({
            kind: "childListReadStarted",
            path: entryPath,
            actionType: entry.action?.type ?? null,
        });
        await hydrateActionDetail(
            ctx,
            entry,
            work,
            observed.length,
            read,
            entryPath,
            subStepSnapshot,
            currentAccount
        );
        const entryUnits = currentAccount.finish();
        totalHydrateUnits += entryUnits - currentEntryEstimate;
        completedHydrateUnits += entryUnits;
        currentAccount = null;
        completed++;
        emit();
        if (isTopLevelRead) {
            emitObservedSnapshot(observed, events);
        }
    }
}

async function hydrateActionDetail(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void,
    account?: HydrationEntryAccount
): Promise<void> {
    try {
        return await hydrateActionDetailFromEditor(ctx, entry, work, listLength, read, entryPath, emitSnapshot, account);
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        const inner = error instanceof Error ? error.message : String(error);
        const path = entryPath === undefined ? `index ${entry.index}` : actionPathKey(entryPath);
        const typeName = entry.action?.type ?? "<null>";
        throw new Error(`(at ${path}, ${typeName}) ${inner}`);
    }
}

async function hydrateActionDetailFromEditor(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void,
    account?: HydrationEntryAccount
): Promise<void> {
    if (entry.action === null) {
        return;
    }

    const note = entry.action.note;
    await goToPaginatedListPage(ctx, getPaginatedListPageForIndex(entry.index), ACTION_LIST_CONFIG);
    const actionSlot = await getPaginatedListSlotAtIndex(ctx, entry.index, listLength, ACTION_LIST_CONFIG);
    entry.slot = actionSlot;
    entry.slotId = actionSlot.getSlotId();

    actionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const spec = getActionSpec(entry.action.type);

    if (spec.read) {
        const readCtx = createActionReadContext({
            ctx,
            actionPath: entryPath,
            actionType: entry.action.type,
            itemRegistry: read?.itemRegistry,
            itemCaptures: read?.itemCaptures,
            events: read?.events,
            emitSnapshot,
            readChildActions: readActionList,
            readConditions: readConditionList,
            ...(account === undefined
                ? {}
                : {
                      childListProgress: (prop: ChildListName) => ({
                          progress: (payload: ProgressPayload) =>
                              account.onChildPayload(prop, payload),
                          phaseUnits: {
                              setup: 0,
                              reading: 0,
                              hydrating: 0,
                              applying: 0,
                          },
                      }),
                  }),
        });
        entry.action = await spec.read({
            ctx,
            childListsToRead: work.childListsToRead,
            read: readCtx,
            current: entry.action,
        });
        entry.childListReadState = "deep";
        if (note) {
            entry.action.note = note;
        }
    } else if (work.childListsToRead.size > 0) {
        throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
    } else {
        refreshTruncatedScalarFields(ctx, entry.action, work.scalarFieldsToRead);
        entry.childListReadState = "deep";
    }

    if (read?.itemCaptures !== undefined && entry.action !== null) {
        const itemFields = work.itemFieldsToCapture;
        for (let i = 0; i < itemFields.length; i++) {
            const field = itemFields[i];
            const displayName = (entry.action as Record<string, unknown>)[field.prop];
            if (typeof displayName === "string" && displayName.length > 0) {
                const captured = await captureItemFromOpenEditorField(
                    ctx,
                    field.label,
                    read.itemCaptures,
                    displayName
                );
                if (captured !== null) {
                    (entry.action as Record<string, unknown>)[field.prop] = captured;
                }
            }
        }
    }

    await clickGoBack(ctx);
}
