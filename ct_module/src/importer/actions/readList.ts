import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import {
    clickGoBack,
    timedWaitForMenu,
} from "../helpers";
import { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import {
    ACTION_MAPPINGS,
    getNestedListFields,
    isItemBearingActionType,
    parseActionListItem,
    tryGetActionTypeFromDisplayName,
} from "../actionMappings";
import {
    CONDITION_MAPPINGS,
    tryGetConditionTypeFromDisplayName,
} from "../conditionMappings";
import { canonicalizeItemFields } from "../canonicalizeItems";
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
import type { ItemCaptureRegistry } from "../itemCapture";
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
} from "../paginatedList";
import { getActiveDiffSink } from "../diffSink";
import { COST, actionListRoughBudget, hydrationEntryBudget } from "../progress/costs";
import { ACTION_LIST_CONFIG } from "./listConfig";
import {
    getActionSpec,
    getCurrentWritingActionPath,
    readOpenConditional,
    type ConditionalReadHooks,
} from "../actions";
import { actionLogLabel } from "./log";
import { waitIfStepPaused } from "../stepGate";
import { traceEvent } from "../traceLog";
import { isInExportSession } from "../../importables/exportSession";

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
            // Pre-fill the nested array with N null entries so the live
            // preview can render a `...N actions...` (or `(...N conditions...)`)
            // placeholder showing the known count even before hydration
            // fills the real data. Without this, the field would be
            // undefined and the model would render the conditional as
            // `if (...) {}` (empty body, no count cue).
            const placeholders: Array<unknown> = [];
            for (let i = 0; i < itemTypes.length; i++) placeholders.push(null);
            Object.assign(action, { [prop]: placeholders });
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
    const observed = await readPaginatedList(
        ctx,
        ACTION_LIST_CONFIG,
        () => readActionsListPage(ctx),
        ({ totalEntries, pagesRead }) => {
            readEstimatedCompleted = Math.max(0, pagesRead - 1) * COST.pageTurnWait;
            progress?.({
                phase: "reading",
                completed: totalEntries,
                total: Math.max(desiredTotal, totalEntries),
                label: `${totalEntries} actions read`,
                estimatedCompleted: readEstimatedCompleted,
                estimatedTotal: Math.max(roughEstimate, readEstimatedCompleted),
                confidence: "rough",
            });
        }
    );
    // Top-level read complete: hand the snapshot to the live preview so
    // it can render the (still-unhydrated) observed actions immediately.
    // Nested action lists are mostly null at this point — they fill in
    // as `hydrateNestedActions` walks them below.
    //
    // Gated so that nested recursive reads (inside CONDITIONAL/RANDOM
    // bodies) and apply-phase reads don't blow away the live preview
    // model with partial inner content. Two top-level entry points
    // qualify:
    //
    //   - `/import` session: `kind: "sync"` with no active writer.
    //     The first guard rules out nested CONDITIONAL/RANDOM hydration
    //     reads (which use `kind: "full"` — different branch). The
    //     second rules out the apply phase's nested `syncActionList`
    //     calls — those ALSO use `kind: "sync"` but run inside
    //     `withWritingActionPath`.
    //
    //   - `/export function` / `/export menu`: `kind: "full"` with
    //     `mode.topLevel === true`. The exporter sets the flag
    //     explicitly at its top-level call. Recursive full-mode reads
    //     inside `readOpenConditional` / `readOpenRandom` omit it (it
    //     defaults to false) so they self-identify as nested.
    const isTopLevelSyncImport =
        mode.kind === "sync" && getCurrentWritingActionPath() === null;
    const isTopLevelExport =
        mode.kind === "full" && mode.topLevel === true && isInExportSession();
    const isTopLevelReadOperation = isTopLevelSyncImport || isTopLevelExport;
    if (isTopLevelReadOperation) {
        emitObservedSnapshot(observed);
        // Trace: full top-level observed snapshot (with the still-null
        // nested entries — count is known from summaries even though
        // the actual nested actions aren't read yet).
        traceEvent("read-top-level-complete", {
            count: observed.length,
            observed: observed.map((entry) => ({
                index: entry.index,
                action: entry.action,
                nestedSummaries: entry.nestedSummaries,
                nestedReadState: entry.nestedReadState,
            })),
        });
        // Step-debug checkpoint: user can observe the freshly-read
        // top-level state (still-unhydrated nested children render as
        // `...` placeholders) before hydration begins.
        await waitIfStepPaused(ctx);
    }
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
    const itemCaptures =
        mode.kind === "full" ? mode.itemCaptures : undefined;
    if (itemCaptures !== undefined) {
        addItemCaptureHydrationEntries(plan, observed);
    }
    await hydrateNestedActions(
        ctx,
        plan,
        observed,
        mode.itemRegistry,
        itemCaptures,
        progress,
        readEstimatedCompleted,
        isTopLevelReadOperation
    );
    canonicalizeObservedActionItemNames(observed, mode.itemRegistry);
    // Final snapshot after canonicalization. Only at the top level — a
    // recursive nested read would otherwise wipe the unrelated rest of
    // the model.
    if (isTopLevelReadOperation) {
        emitObservedSnapshot(observed);
        // Hydration is done — drop the read cursor before the diff
        // planning (or export-write) phase fires so the blue ▶ doesn't
        // ghost-stick onto the last-read line through whatever comes
        // next.
        getActiveDiffSink()?.clearReading?.();
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    return observed;
}

/**
 * Hand the current observed snapshot to the live preview model. The sink
 * is best-effort — if no GUI sink is active (e.g., the exporter is
 * driving readActionList), this is a no-op.
 *
 * We strip the `Observed` brand by pretending entries are Action[]; the
 * preview model is permissive about partially-hydrated nested arrays.
 */
function emitObservedSnapshot(observed: readonly ObservedActionSlot[]): void {
    const sink = getActiveDiffSink();
    if (sink === undefined || sink === null || sink.setObservedSnapshot === undefined) return;
    const out: Array<Action | null> = [];
    for (const entry of observed) {
        out.push(entry.action as Action | null);
    }
    try {
        sink.setObservedSnapshot(out);
    } catch (_e) {
        // Preview-side failures must never abort the importer.
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

/**
 * Item-bearing actions normally stay out of the hydration plan because
 * their fields are fully recoverable from list-item lore. When the
 * caller opts in via `itemCaptures`, we add them with an empty
 * propsToRead so the framework will open each editor — the spec.read
 * function then performs the click-to-copy NBT capture before clicking
 * back.
 */
function addItemCaptureHydrationEntries(
    plan: NestedHydrationPlan,
    observed: readonly ObservedActionSlot[]
): void {
    for (const entry of observed) {
        if (entry.action === null || plan.has(entry)) continue;
        if (isItemBearingActionType(entry.action.type)) {
            plan.set(entry, new Set());
        }
    }
}

function shouldHydrateScalarAction(action: Observed<Action>): boolean {
    if (action.type === "MESSAGE") {
        return removedFormatting(action.message).trim().endsWith("...");
    }

    if (action.type === "ACTION_BAR") {
        return removedFormatting(action.message).trim().endsWith("...");
    }

    if (action.type === "TITLE") {
        const title = action.title;
        const subtitle = action.subtitle;
        return (
            (typeof title === "string" &&
                removedFormatting(title).trim().endsWith("...")) ||
            (typeof subtitle === "string" &&
                removedFormatting(subtitle).trim().endsWith("..."))
        );
    }

    if (action.type === "FAIL_PARKOUR") {
        return (
            typeof action.message === "string" &&
            removedFormatting(action.message).trim().endsWith("...")
        );
    }

    if (action.type === "FUNCTION") {
        return removedFormatting(action.function).trim().endsWith("...");
    }

    if (action.type === "SET_MENU") {
        return removedFormatting(action.menu).trim().endsWith("...");
    }

    if (action.type === "APPLY_INVENTORY_LAYOUT") {
        return removedFormatting(action.layout).trim().endsWith("...");
    }

    if (action.type === "PLAY_SOUND") {
        const sound = (action as { sound?: unknown }).sound;
        if (
            typeof sound === "string" &&
            removedFormatting(sound).trim().endsWith("...")
        ) {
            return true;
        }
        // PLAY_SOUND's location-truncation case is handled by the
        // location-bearing block below; fall through.
    }

    // Location-bearing actions: hydrate when Hypixel truncated the
    // coord string with `...` in the list-item lore. The editor's slot
    // shows the full untruncated value.
    if (
        action.type === "TELEPORT" ||
        action.type === "PLAY_SOUND" ||
        action.type === "SET_COMPASS_TARGET" ||
        action.type === "DROP_ITEM" ||
        action.type === "LAUNCH"
    ) {
        const loc = (action as { location?: unknown }).location;
        if (
            typeof loc === "object" &&
            loc !== null &&
            (loc as { type?: unknown }).type === "Custom Coordinates"
        ) {
            const value = (loc as { value?: unknown }).value;
            if (typeof value === "string" && value.endsWith("...")) {
                return true;
            }
        }
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
    observed: readonly ObservedActionSlot[],
    itemRegistry?: ItemRegistry,
    itemCaptures?: ItemCaptureRegistry,
    progress?: ActionListProgressSink,
    baseEstimatedCompleted: number = 0,
    isTopLevelReadOperation: boolean = false
): Promise<void> {
    const listLength = observed.length;
    let completed = 0;
    const total = plan.size;
    let completedBudget = 0;
    let totalBudget = 0;
    plan.forEach((propsToRead, entry) => {
        totalBudget += hydrationEntryBudget(entry, propsToRead);
    });
    for (const [entry, propsToRead] of plan) {
        const entryLabel = `reading nested ${actionLogLabel(entry.action)}`;
        progress?.({
            phase: "hydrating",
            completed,
            total,
            label: entryLabel,
            estimatedCompleted: baseEstimatedCompleted + completedBudget,
            estimatedTotal: baseEstimatedCompleted + totalBudget,
            confidence: "informed",
        });
        const sinkRef = getActiveDiffSink();
        sinkRef?.phase(entryLabel);
        // Show the blue ▶ + autoscroll on the entry's source line for
        // the duration of its hydration. Only at the top level — nested
        // recursive reads (CONDITIONAL bodies inside CONDITIONAL bodies)
        // would otherwise jump the cursor to inner indices that aren't
        // even rendered as their own lines yet. `entry.index` IS the
        // top-level source index when invoked from the top-level read.
        if (isTopLevelReadOperation && sinkRef !== null && sinkRef.setReading !== undefined) {
            sinkRef.setReading(String(entry.index), entryLabel);
        }
        const beforeBudget = hydrationEntryBudget(entry, propsToRead);
        if (isTopLevelReadOperation) {
            traceEvent("hydrate-entry-begin", {
                index: entry.index,
                actionType: entry.action?.type ?? null,
                propsToRead: Array.from(propsToRead),
                nestedSummaries: entry.nestedSummaries,
            });
        }
        await hydrateNestedAction(
            ctx,
            entry,
            propsToRead,
            listLength,
            itemRegistry,
            itemCaptures,
            isTopLevelReadOperation ? observed : undefined
        );
        // After each top-level entry's hydration, push a fresh full
        // snapshot so the preview re-renders with the now-known
        // children AND the now-known conditions inside the conditional's
        // head line (a surgical nested-only emit would miss the head).
        // The `isTopLevelReadOperation` guard keeps nested writer-driven reads
        // from blowing away the model.
        if (isTopLevelReadOperation) {
            traceEvent("hydrate-entry-complete", {
                index: entry.index,
                actionAfter: entry.action,
                nestedReadState: entry.nestedReadState,
            });
            emitObservedSnapshot(observed);
            // Step-debug checkpoint after each hydration entry — user
            // gets to watch one conditional/random fill in at a time.
            // Cursor stays on this entry's line through the gate so the
            // user sees what was just read.
            await waitIfStepPaused(ctx);
        }
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
    itemRegistry?: ItemRegistry,
    itemCaptures?: ItemCaptureRegistry,
    observedTopLevel?: readonly ObservedActionSlot[]
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

        // Top-level CONDITIONAL hydration uses a sub-stepped read so the
        // live preview can split the visualization into discrete phases:
        //   1) cursor on `if (...) {` while reading conditions, then the
        //      head text updates to show the real conditions
        //   2) cursor moves to the `...M actions...` placeholder while
        //      reading ifActions, then the body fills with real lines
        //   3) similar for elseActions if they exist
        // Non-CONDITIONAL action types and recursive nested reads use
        // the standard one-shot spec.read path. Item capture (`itemCaptures`)
        // threads through both branches so nested item-bearing actions
        // inside a CONDITIONAL still get their NBT captured on export.
        if (
            entry.action.type === "CONDITIONAL"
            && observedTopLevel !== undefined
        ) {
            await hydrateConditionalSubsteps(
                ctx,
                entry,
                propsToRead,
                itemRegistry,
                itemCaptures,
                observedTopLevel
            );
        } else {
            const spec = getActionSpec(entry.action.type);
            if (!spec.read) {
                throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
            }
            entry.action = await spec.read(
                ctx,
                propsToRead,
                itemRegistry,
                itemCaptures,
                entry.action
            );
        }
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

/**
 * Drive `readOpenConditional` with visualization hooks for the live
 * preview. The hooks fire trace events, push snapshots so the model
 * re-renders with the now-known content, and move the read cursor onto
 * each sub-list's `...N actions...` placeholder line.
 *
 * Mutates `entry.action` in place after each sub-step (via the hook
 * snapshot path) so the GUI sees incremental progress. The standard
 * `spec.read(...)` path returns the action only at the end; we replace
 * it explicitly at the bottom for the same effect.
 */
async function hydrateConditionalSubsteps(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead,
    itemRegistry: ItemRegistry | undefined,
    itemCaptures: ItemCaptureRegistry | undefined,
    observedTopLevel: readonly ObservedActionSlot[]
): Promise<void> {
    if (entry.action === null) return;
    const actionPath = String(entry.index);
    const sink = getActiveDiffSink();
    // Each hook reflects the freshly-read sub-list onto entry.action so
    // the snapshot emit publishes incremental progress (head re-renders
    // with real conditions; body's `...M actions...` placeholder fills
    // in once ifActions arrive; etc).
    const action = entry.action as unknown as {
        conditions?: unknown[];
        ifActions?: unknown[];
        elseActions?: unknown[];
    };
    const hooks: ConditionalReadHooks = {
        onConditionsRead: async (conditions) => {
            action.conditions = [...conditions];
            traceEvent("conditional-conditions-read", { actionPath, conditions });
            emitObservedSnapshot(observedTopLevel);
            await waitIfStepPaused(ctx);
        },
        onIfActionsBefore: async () => {
            // Cursor onto the `...M actions...` consolidated placeholder
            // (its actionPath is `<conditional>.ifActions`).
            if (sink && sink.setReading) {
                sink.setReading(`${actionPath}.ifActions`, "reading ifActions");
            }
        },
        onIfActionsRead: async (ifActions) => {
            action.ifActions = [...ifActions];
            traceEvent("conditional-ifActions-read", {
                actionPath,
                count: ifActions.length,
                ifActions,
            });
            emitObservedSnapshot(observedTopLevel);
            await waitIfStepPaused(ctx);
        },
        onElseActionsBefore: async () => {
            if (sink && sink.setReading) {
                sink.setReading(`${actionPath}.elseActions`, "reading elseActions");
            }
        },
        onElseActionsRead: async (elseActions) => {
            action.elseActions = [...elseActions];
            traceEvent("conditional-elseActions-read", {
                actionPath,
                count: elseActions.length,
                elseActions,
            });
            emitObservedSnapshot(observedTopLevel);
            await waitIfStepPaused(ctx);
        },
    };
    entry.action = await readOpenConditional(
        ctx,
        propsToRead,
        itemRegistry,
        itemCaptures,
        hooks
    );
    // Park the cursor back on the conditional itself before we return —
    // hydrateNestedActions's outer step-gate fires next with the cursor
    // expected on the entry being hydrated.
    if (sink && sink.setReading) {
        sink.setReading(actionPath, `reading nested ${actionLogLabel(entry.action)}`);
    }
}
