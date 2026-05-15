import type { Action, Importable } from "htsw/types";

import type {
    ActionListDiff,
    ActionListOperation,
    ConditionListDiff,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot,
    UiFieldKind,
} from "../types";
import { diffActionList } from "../actions/diff";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { scalarFieldDiffers } from "../fields/compare";

export type EtaConfidence = "rough" | "informed" | "planned";

/**
 * Per-op-kind budget costs in abstract "units". Calibrated against
 * `guaranteedSleep1000 = 4` as the 1-second anchor, so 1 unit ≈ 250ms.
 *
 * Costs are tuned so each kind's *real* avg ms / unit lands close to a
 * common ~150-160 ms/u band — that way ETA projections stay accurate
 * even when an importable's op mix is skewed (e.g. lots of `itemSelect`
 * vs lots of `anvilInput`). When a per-op ms/u drifts noticeably from
 * the band, bump the cost to compensate. Latest sample basis (n=samples):
 *   commandMenuWait 2.9 (n=26 @ 433ms → ~150 ms/u)
 *   menuClickWait 2.0  (n=1451 @ 283ms → ~141 ms/u)
 *   pageTurnWait 1.7   (n=36 @ 258ms → ~152 ms/u)
 *   goBackWait 2.0     (n=521 @ 316ms → ~158 ms/u)
 *   chatInput 3.0      (n=497 @ 472ms → ~157 ms/u)
 *   anvilInput 4.0     (n=6 @ 605ms → ~151 ms/u)
 *   itemSelect 1.6     (n=4 @ 238ms → ~149 ms/u)
 *
 * Re-tune via `/htsw eta dump`, then divide each kind's `avgMs` by the
 * target band rate to get the new unit value.
 */
export const COST = {
    commandInterval: 1,
    commandMenuWait: 2.9,
    commandMessageWait: 2,

    menuClickWait: 2,
    messageClickWait: 2,
    pageTurnWait: 1.7,
    goBackWait: 2,

    chatInput: 3,
    anvilInput: 4,
    itemSelect: 1.6,

    reorderStep: 1.5,
    guaranteedSleep1000: 4,

    readVisiblePage: 0,
    scalarRead: 0,
    diffCompute: 0,
    knowledgeWrite: 0.25,
    nbtCapture: 0.25,
    itemInject: 1,
};

const ACTIONS_PER_PAGE = 21;

function pagesForActionCount(count: number): number {
    return Math.max(1, Math.ceil(Math.max(0, count) / ACTIONS_PER_PAGE));
}

function pageTurnBudgetForActionCount(count: number): number {
    return Math.max(0, pagesForActionCount(count) - 1) * COST.pageTurnWait;
}

function fieldKindEditBudget(kind: UiFieldKind): number {
    if (kind === "boolean") return COST.menuClickWait;
    if (kind === "cycle") return COST.menuClickWait * 2;
    if (kind === "select") return COST.menuClickWait + COST.menuClickWait;
    if (kind === "item") return COST.itemSelect;
    if (kind === "value") return COST.chatInput;
    if (kind === "nestedList") return COST.menuClickWait;
    return COST.menuClickWait;
}

export function scalarFieldEditBudgetForOp(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    const action = op.observed.action;
    if (action === null || op.noteOnly) return 0;

    let total = 0;
    const fields = getActionScalarLoreFields(action.type);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (scalarFieldDiffers(action, op.desired, action.type, field.prop)) {
            total += fieldKindEditBudget(field.kind);
        }
    }
    return total;
}

export function moveBudget(fromIndex: number, toIndex: number, listLength: number): number {
    if (listLength <= 1) return 0;
    const from = ((fromIndex % listLength) + listLength) % listLength;
    const to = ((toIndex % listLength) + listLength) % listLength;
    const rightDistance = (to - from + listLength) % listLength;
    const leftDistance = (from - to + listLength) % listLength;
    return Math.min(leftDistance, rightDistance) * COST.reorderStep;
}

function nestedActionReadBudget(nestedCount: number): number {
    return (
        COST.menuClickWait +
        COST.menuClickWait +
        pageTurnBudgetForActionCount(nestedCount) +
        COST.goBackWait +
        COST.goBackWait
    );
}

export function hydrationEntryBudget(
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead
): number {
    if (entry.action === null) return 0;

    let total = COST.menuClickWait + COST.goBackWait;
    propsToRead.forEach((prop) => {
        total += nestedPropReadBudget(entry, prop);
    });
    return total;
}

function nestedPropReadBudget(entry: ObservedActionSlot, prop: NestedListProp): number {
    const summary = entry.nestedSummaries ? entry.nestedSummaries[prop] : undefined;
    const count = summary === undefined ? 1 : summary.length;
    return COST.menuClickWait + pageTurnBudgetForActionCount(count) + COST.goBackWait;
}

function noteEditBudget(): number {
    return COST.chatInput;
}

function actionAddShellBudget(): number {
    return COST.menuClickWait + COST.menuClickWait;
}

/**
 * Rough per-condition shell + scalar-fields cost: open the condition
 * editor (menu click), set its scalar fields (one chat input as a
 * reasonable average — most conditions have one configurable value),
 * close the editor. Conditions can't contain nested action lists, so
 * this stays flat per condition.
 */
function conditionRoughBudget(): number {
    return COST.menuClickWait + COST.chatInput + COST.menuClickWait;
}

function conditionListRoughBudget(conditions: readonly unknown[]): number {
    return conditions.length * conditionRoughBudget();
}

export function conditionListDiffApplyBudget(diff: ConditionListDiff): number {
    let total = 0;
    for (let i = 0; i < diff.operations.length; i++) {
        const op = diff.operations[i];
        if (op.kind === "delete") {
            total += COST.menuClickWait;
        } else if (op.kind === "add") {
            total += conditionRoughBudget();
        } else {
            total += op.noteOnly ? noteEditBudget() : conditionRoughBudget();
            if (op.desired.note !== op.observed.condition?.note) total += noteEditBudget();
        }
    }
    return total;
}

/**
 * Cost of writing one action's payload (scalar fields + any nested
 * action/condition lists) once its shell has been added. Scalar fields
 * each cost a `chatInput`; array fields recurse — `conditions` via
 * `conditionListRoughBudget`, action-list arrays (e.g. `ifActions`,
 * `elseActions`, `actions` for RANDOM) via `actionListRoughApplyBudget`.
 *
 * Recursion terminates because CONDITIONAL/RANDOM aren't allowed to
 * nest — the inner action lists only contain non-CONDITIONAL,
 * non-RANDOM actions, none of which carry action-list arrays. Returns
 * at least `menuClickWait` so a fieldless action (e.g. Kill Player)
 * still costs the menu round-trip to commit the add.
 */
function actionWriteRoughBudget(action: Action): number {
    let total = 0;
    for (const key in action) {
        if (key === "type" || key === "note") continue;
        const value = (action as { [key: string]: unknown })[key];
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            if (key === "conditions") {
                total += conditionListRoughBudget(value);
            } else {
                total += actionListRoughApplyBudget(value as Action[]);
            }
            continue;
        }
        total += COST.chatInput;
    }
    return Math.max(COST.menuClickWait, total);
}

function actionListRoughApplyBudget(actions: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < actions.length; i++) {
        total += actionAddShellBudget() + actionWriteRoughBudget(actions[i]);
        if (actions[i].note !== undefined) total += noteEditBudget();
    }
    return total;
}

export function actionListDiffApplyBudget(
    diff: ActionListDiff,
    fieldBudgetForEdit: (op: Extract<ActionListOperation, { kind: "edit" }>) => number,
    desiredLength: number
): number {
    let total = 0;
    for (let i = 0; i < diff.operations.length; i++) {
        const op = diff.operations[i];
        if (op.kind === "delete") {
            total += COST.menuClickWait;
        } else if (op.kind === "move") {
            total += moveBudget(op.observed.index, op.toIndex, desiredLength);
        } else if (op.kind === "add") {
            total += actionAddShellBudget() + actionWriteRoughBudget(op.desired);
            total += moveBudget(desiredLength, op.toIndex, desiredLength + 1);
            if (op.desired.note !== undefined) total += noteEditBudget();
        } else {
            total += op.noteOnly
                ? noteEditBudget()
                : COST.menuClickWait + fieldBudgetForEdit(op) + COST.goBackWait;
            if (op.desired.note !== op.observed.action?.note) total += noteEditBudget();
        }
    }
    return total;
}

/**
 * Per-phase work budget for a single action-list sync call. Lets `readList`
 * + `applyDiff` emit `estimatedCompleted` / `estimatedTotal` in a single
 * coherent scale across the three real phases (reading → hydrating →
 * applying), and lets the GUI's ETA split remaining work by phase.
 *
 * Diffing is intentionally not tracked — it's pure in-process compute
 * with no menu round-trips, takes ~1-5ms, and would just add noise to
 * the timing data. The `phase: "diffing"` progress event still fires
 * for the GUI's diff-sink visualization but contributes nothing to ETA.
 *
 * `readPart` / `hydratePart` cover this list only — nested `syncActionList`
 * calls inside CONDITIONAL/RANDOM bodies aren't separately tracked because
 * their reading is folded into the parent's hydrate phase (via
 * `topLevelHydrateBudget`). `applyPart` does include nested-body apply
 * work via the cache-aware diff recursing one level into
 * `ifActions` / `elseActions` / `actions` (see `editBudgetWithNested`).
 */
export type ActionListPhaseBudget = {
    readPart: number;
    hydratePart: number;
    applyPart: number;
    total: number;
};

function topLevelHydrateBudget(desired: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < desired.length; i++) {
        const a = desired[i];
        if (a.type === "CONDITIONAL") {
            total += nestedActionReadBudget(a.ifActions.length);
            total += nestedActionReadBudget(a.elseActions.length);
            if (a.conditions.length > 0) total += COST.menuClickWait + COST.goBackWait;
        } else if (a.type === "RANDOM") {
            total += nestedActionReadBudget(a.actions.length);
        }
    }
    return total;
}

/**
 * Predict per-phase budget for a single action-list sync.
 *
 * Two cases, no mixed worldviews:
 *
 * 1. **Cache available** (`cached !== undefined`): we have a snapshot
 *    of what the housing looked like last time. Use it as the ground
 *    truth for the read + hydrate phases (housing is *probably* still
 *    in that state), and run the real diff `cached → desired` to price
 *    the apply phase.
 *
 * 2. **No cache** (`cached === undefined`): we don't know what the
 *    housing has — first-ever import for this house, or cache was
 *    wiped. Assume the housing is *empty*: zero pages to turn, nothing
 *    to hydrate, and every desired action must be added from scratch.
 *
 * The estimate self-corrects during the run: `readPart` and
 * `hydratePart` bump up one-way if reality exceeds prediction, and
 * `applyPart` is *replaced* with the real diff cost once
 * `readActionList` + `diffActionList` have observed the actual
 * housing.
 */
export function estimateActionListPhaseBudget(
    desired: readonly Action[],
    cached?: readonly Action[]
): ActionListPhaseBudget {
    if (cached === undefined) {
        const applyPart = actionListRoughApplyBudget(desired);
        return { readPart: 0, hydratePart: 0, applyPart, total: applyPart };
    }
    const readPart = pageTurnBudgetForActionCount(cached.length);
    const hydratePart = topLevelHydrateBudget(cached);
    const applyPart = cacheAwareApplyBudget(desired, cached);
    return {
        readPart,
        hydratePart,
        applyPart,
        total: readPart + hydratePart + applyPart,
    };
}

/**
 * Convert a cached `Action[]` (snapshot of last-known housing state) into
 * a hypothetical `ObservedActionSlot[]` so it can be fed into
 * `diffActionList`. The slots are stubs — no real `ItemSlot` references —
 * which is fine since `diffActionList` only reads `index` + `action`.
 *
 * Structural typing accepts the plain `Action` here because
 * `diffActionList` only consumes the action data and never inspects the
 * `Observed<>` brand.
 */
function cachedActionsAsObserved(cached: readonly Action[]): ObservedActionSlot[] {
    const out: ObservedActionSlot[] = [];
    for (let i = 0; i < cached.length; i++) {
        out.push({
            index: i,
            slotId: -1,
            slot: null as never,
            action: cached[i],
            nestedReadState: "full",
        });
    }
    return out;
}

/**
 * Compute the apply-phase budget for transforming `cached` → `desired`,
 * by running the real diff and pricing each operation. Used to tighten
 * ETA estimates when we have a recent knowledge cache for the housing.
 *
 * Returns 0 when cached and desired are identical (the bar predicts a
 * near-instant pass for this list).
 */
function cacheAwareApplyBudget(
    desired: readonly Action[],
    cached: readonly Action[]
): number {
    const observed = cachedActionsAsObserved(cached);
    const diff = diffActionList(observed, desired as Action[]);
    return actionListDiffApplyBudget(diff, editBudgetWithNested, desired.length);
}

/**
 * Edit-op cost for the cache-aware apply path. Scalar field changes are
 * derived from the edit op's observed/desired pair.
 *
 * `getActionScalarLoreFields` strips out `nestedList` field kinds, so
 * the scalar pass never prices changes to CONDITIONAL.ifActions /
 * elseActions / RANDOM.actions — even though the diff engine still
 * emits an edit op when those bodies differ (its `actionsEqual` does a
 * deep compare). Without this wrapper, a CONDITIONAL whose ifActions
 * grew by 30 actions would be priced as `menuClickWait + 0 + goBackWait`
 * and the bar would silently under-count by the cost of those 30
 * additions, making the live `refinedWeightCurrent` widening do all
 * the catch-up work.
 *
 * We re-run the diff one level deeper for any CONDITIONAL/RANDOM edit
 * and add the nested apply cost. The HTSL constraint that
 * CONDITIONAL/RANDOM can't appear inside another CONDITIONAL/RANDOM
 * body bounds the recursion at one level.
 */
function editBudgetWithNested(op: Extract<ActionListOperation, { kind: "edit" }>): number {
    let total = scalarFieldEditBudgetForOp(op);

    for (let i = 0; i < op.nestedDiffs.length; i++) {
        const nested = op.nestedDiffs[i];
        if (nested.diff.operations.length === 0) continue;
        total += COST.menuClickWait + COST.goBackWait;
        if (nested.prop === "conditions") {
            total += conditionListDiffApplyBudget(nested.diff);
        } else {
            total += actionListDiffApplyBudget(
                nested.diff,
                editBudgetWithNested,
                nested.diff.desiredLength
            );
        }
    }
    return total;
}

/**
 * Total work for one action-list sync (read + hydrate + apply). Wraps
 * `estimateActionListPhaseBudget`'s three parts back into a single
 * number. Used by `estimateImportableCost` to weight importables.
 */
function actionListCost(
    desired: readonly Action[],
    cached: readonly Action[] | undefined
): number {
    return estimateActionListPhaseBudget(desired, cached).total;
}

/**
 * Total work estimate for one importable in budget units. The optional
 * `getCached(basePath)` callback returns the last-known cached actions
 * for the importable's action-list fields (e.g. `"actions"`,
 * `"onEnterActions"`). Pass `undefined` for the no-cache path; phase
 * budgets fall back to "assume housing is empty" → predict only the
 * worst-case apply work.
 *
 * MENU / NPC fall through to a cache-blind rough estimate — their slots
 * have variable indexing and aren't worth special-casing yet.
 */
export function estimateImportableCost(
    importable: Importable,
    getCached?: (basePath: string) => readonly Action[] | undefined
): number {
    const get = (path: string): readonly Action[] | undefined =>
        getCached === undefined ? undefined : getCached(path);

    if (importable.type === "FUNCTION") {
        return (
            COST.commandMenuWait +
            actionListCost(importable.actions, get("actions")) +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(importable.actions, get("actions")) +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandMessageWait * 3 +
            COST.commandMenuWait +
            actionListCost(importable.onEnterActions ?? [], get("onEnterActions")) +
            actionListCost(importable.onExitActions ?? [], get("onExitActions")) +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "ITEM") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        if (left.length === 0 && right.length === 0) {
            return COST.itemInject + COST.knowledgeWrite;
        }
        return (
            COST.itemInject +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(left, get("leftClickActions")) +
            actionListCost(right, get("rightClickActions")) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "MENU") {
        return (
            COST.commandMenuWait +
            (importable.slots?.length ?? 0) * COST.menuClickWait +
            COST.knowledgeWrite
        );
    }
    return COST.commandMenuWait + COST.knowledgeWrite;
}
