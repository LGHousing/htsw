import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ItemRegistry } from "../../importables/itemRegistry";
import { clickGoBack } from "../gui/menuUtils";
import { timedWaitForMenu } from "../gui/menuWait";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    ACTION_MAPPINGS,
    getActionLoreFields,
    getActionScalarLoreFields,
    getNestedListFields,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../fields/actionMappings";
import { captureItemFromOpenEditorField } from "../itemCapture";
import { IMPORT_DEBUG } from "../diagnostics/importDebug";
import { refreshTruncatedScalarFields } from "./readers";
import { isTruncatableKind, looksTruncated } from "../fields/loreParsing";
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
    ListReadOptions,
} from "../types";
import { createNestedHydrationPlan } from "./hydrationPlan";
import { matchObservedToDesired } from "./nestedMatching";
import { applyActionListTrust } from "./applyTrust";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
} from "../gui/paginatedList";
import type { ActionPath, ImportEventHandler } from "../importEvents";
import { actionPathForIndex, actionPathKey } from "../importEvents";
import {
    COST,
    hydrationEntryUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import { ACTION_LIST_CONFIG } from "./listConfig";
import { getActionSpec } from "./specs";
import { actionLogLabel } from "./log";
import { createActionReadContext } from "../context/actionReadContext";
import { readConditionList } from "../conditions/readList";

export type ActionListReadMode =
    | { kind: "full" }
    | { kind: "sync"; desired: readonly Action[]; trust?: ActionListTrust };

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
            // Seed one null per item so the preview can show the count
            // ("...3 conditions..." / "...3 actions...") before hydration
            // fills the real entries in. Guarded so a field the parser
            // already populated as an array isn't clobbered.
            if (!Array.isArray((action as Record<string, unknown>)[prop])) {
                Object.assign(action, { [prop]: itemTypes.map(() => null) });
            }
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
    mode: ActionListReadMode = { kind: "full" },
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
    let plan: NestedHydrationPlan;
    if (isTopLevelRead) {
        // Only the top-level read can encounter nested-list-bearing
        // actions (CONDITIONAL/RANDOM). CONDITIONAL/RANDOM are disallowed
        // inside their own ifActions/elseActions/actions, so any inner
        // read's hydration plan can only carry scalar truncation entries.
        // Skip the nested-plan computation entirely at inner levels.
        if (mode.kind === "full") {
            plan = buildFullHydrationPlan(observed);
        } else {
            const matches = matchObservedToDesired(observed, mode.desired);
            plan = createNestedHydrationPlan(matches);
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
    await hydrateNestedActions(
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
    events?: ImportEventHandler
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
    plan: NestedHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null || plan.has(entry)) continue;
        if (getItemFieldsForCapture(entry.action.type).length > 0) {
            plan.set(entry, new Set());
        }
    }
}

function shouldHydrateScalarAction(action: Observed<Action>): boolean {
    const fields = getActionScalarLoreFields(action.type);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!isTruncatableKind(field.kind)) continue;
        const value = (action as Record<string, unknown>)[field.prop];
        if (typeof value === "string" && looksTruncated(value)) return true;
        if (
            field.kind === "location" &&
            typeof value === "object" &&
            value !== null &&
            (value as { type?: unknown }).type === "Custom Coordinates"
        ) {
            const coord = (value as { value?: unknown }).value;
            if (typeof coord === "string" && looksTruncated(coord)) return true;
        }
    }
    if (action.type === "CHANGE_VAR" && action.holder?.type === "Team") {
        const team = action.holder.team;
        if (typeof team === "string" && looksTruncated(team)) return true;
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

export function canonicalizeActionItemName(
    action: Observed<Action> | Action,
    itemRegistry: ItemRegistry
): void {
    canonicalizeItemFields(action, ACTION_MAPPINGS, itemRegistry);

    // Only CONDITIONAL/RANDOM carry nested lists, and their inner actions
    // are guaranteed non-CONDITIONAL/non-RANDOM by spec — so the inner
    // pass is one level deep, no recursion needed.
    for (const nestedField of getNestedListFields(action.type)) {
        const value = (action as Record<string, unknown>)[nestedField.prop];
        if (!Array.isArray(value)) continue;
        const childMapping =
            nestedField.prop === "conditions" ? CONDITION_MAPPINGS : ACTION_MAPPINGS;
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

async function hydrateNestedActions(
    ctx: TaskContext,
    plan: NestedHydrationPlan,
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
    plan.forEach((propsToRead, entry) => {
        totalHydrateUnits += hydrationEntryUnits(entry, propsToRead);
    });
    if (phaseUnits !== undefined) phaseUnits.hydrating = totalHydrateUnits;
    const emit = (_label: string) => {
        if (phaseUnits === undefined) return;
        progress?.({
            phase: "hydrating",
            completedUnits: phaseUnits.reading + completedHydrateUnits,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: { completedUnits: completed, totalUnits: total, parent: null },
        });
    };
    const subStepSnapshot =
        isTopLevelRead && events !== undefined
            ? () => emitObservedSnapshot(observed, events)
            : undefined;
    for (const [entry, propsToRead] of plan) {
        const entryPath = actionPathForIndex(listPath, entry.index);
        const entryLabel = `reading nested ${actionLogLabel(entry.action)}`;
        emit(entryLabel);
        events?.emit({
            kind: "nestedReadStarted",
            path: entryPath,
            actionType: entry.action?.type ?? null,
        });
        const entryUnits = hydrationEntryUnits(entry, propsToRead);
        await hydrateNestedAction(
            ctx,
            entry,
            propsToRead,
            observed.length,
            read,
            entryPath,
            subStepSnapshot
        );
        completedHydrateUnits += entryUnits;
        completed++;
        emit(`${completed}/${total} nested actions read`);
        if (isTopLevelRead) {
            emitObservedSnapshot(observed, events);
        }
    }
}

async function hydrateNestedAction(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void
): Promise<void> {
    if (IMPORT_DEBUG) {
        try {
            return await hydrateNestedActionInner(ctx, entry, propsToRead, listLength, read, entryPath, emitSnapshot);
        } catch (error) {
            const inner = error instanceof Error ? error.message : String(error);
            const path = entryPath === undefined ? `index ${entry.index}` : actionPathKey(entryPath);
            const typeName = entry.action?.type ?? "<null>";
            throw new Error(`(at ${path}, ${typeName}) ${inner}`);
        }
    }
    return hydrateNestedActionInner(ctx, entry, propsToRead, listLength, read, entryPath, emitSnapshot);
}

async function hydrateNestedActionInner(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void
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
            readNestedActions: readActionList,
            readNestedConditions: readConditionList,
        });
        entry.action = await spec.read({
            ctx,
            propsToRead,
            read: readCtx,
            current: entry.action,
        });
        entry.nestedReadState = "full";
        if (note) {
            entry.action.note = note;
        }
    } else if (propsToRead.size > 0) {
        throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
    } else {
        refreshTruncatedScalarFields(ctx, entry.action);
        entry.nestedReadState = "full";
    }

    if (read?.itemCaptures !== undefined && entry.action !== null) {
        const itemFields = getItemFieldsForCapture(entry.action.type);
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
