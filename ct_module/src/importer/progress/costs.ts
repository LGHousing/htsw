import type { Action, Condition, Importable } from "htsw/types";

import type {
    ActionListDiff,
    ActionListOperation,
    ConditionListDiff,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot,
    UiFieldKind,
} from "../types";
import type { PhaseUnits } from "./types";
export type { PhaseUnits };
import { baselineActionListFromActions, diffActionList } from "../actions/diff";
import {
    baselineConditionListFromConditions,
    diffConditionList,
} from "../conditions/diff";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { scalarFieldDiffers } from "../fields/compare";
import { countReferencedShells } from "../../importables/references";

/**
 * Per-op-kind costs in abstract units. Calibrated against
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
    cacheWrite: 0.25,
    nbtCapture: 0.25,
    itemInject: 1,
};

const LIST_ITEMS_PER_PAGE = 21;

function pagesForListItemCount(count: number): number {
    return Math.max(1, Math.ceil(Math.max(0, count) / LIST_ITEMS_PER_PAGE));
}

function pageTurnUnitsForListItemCount(count: number): number {
    return Math.max(0, pagesForListItemCount(count) - 1) * COST.pageTurnWait;
}

function fieldKindEditUnits(kind: UiFieldKind): number {
    if (kind === "boolean") return COST.menuClickWait;
    if (kind === "cycle") return COST.menuClickWait * 2;
    if (kind === "select" || kind === "location") {
        return COST.menuClickWait + COST.menuClickWait;
    }
    if (kind === "item") return COST.itemSelect;
    if (kind === "value") return COST.chatInput;
    if (kind === "nestedList") return COST.menuClickWait;
    return COST.menuClickWait;
}

export function scalarFieldEditUnitsForOp(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    const action = op.baselineAction;
    if (op.noteOnly) return 0;

    let total = 0;
    const fields = getActionScalarLoreFields(action.type);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (scalarFieldDiffers(action, op.desired, action.type, field.prop)) {
            total += fieldKindEditUnits(field.kind);
        }
    }
    return total;
}

function moveUnits(fromIndex: number, toIndex: number, listLength: number): number {
    if (listLength <= 1) return 0;
    const from = ((fromIndex % listLength) + listLength) % listLength;
    const to = ((toIndex % listLength) + listLength) % listLength;
    const rightDistance = (to - from + listLength) % listLength;
    const leftDistance = (from - to + listLength) % listLength;
    return Math.min(leftDistance, rightDistance) * COST.reorderStep;
}

export function conditionListReadUnits(conditionCount: number): number {
    return pageTurnUnitsForListItemCount(conditionCount);
}

function nestedActionReadUnits(nestedCount: number): number {
    return (
        COST.menuClickWait +
        COST.menuClickWait +
        pageTurnUnitsForListItemCount(nestedCount) +
        COST.goBackWait +
        COST.goBackWait
    );
}

export function hydrationEntryUnits(
    entry: ObservedActionSlot,
    propsToRead: NestedPropsToRead
): number {
    if (entry.action === null) return 0;

    let total = COST.menuClickWait + COST.goBackWait;
    propsToRead.forEach((prop) => {
        total += nestedPropReadUnits(entry, prop);
    });
    return total;
}

function nestedPropReadUnits(entry: ObservedActionSlot, prop: NestedListProp): number {
    const summary = entry.nestedSummaries ? entry.nestedSummaries[prop] : undefined;
    const count = summary === undefined ? 1 : summary.length;
    return COST.menuClickWait + pageTurnUnitsForListItemCount(count) + COST.goBackWait;
}

function noteEditUnits(): number {
    return COST.chatInput;
}

/**
 * Per-add shell cost: what `importAction` does *outside* the field-write
 * loop. Click "Add Action", page-turn to find the action type in the
 * paginated add menu, click the action-type slot. The post-write
 * `clickGoBack` is priced inside `actionWriteRoughUnits` instead,
 * because fieldless actions (e.g. Kill Player) skip the editor entirely
 * and so don't pay the goBack.
 *
 * The page-turn term assumes ~1 turn on average to reach the desired
 * action type. Most action types fit within the first two pages.
 */
function actionAddShellUnits(): number {
    return COST.menuClickWait + COST.pageTurnWait + COST.menuClickWait;
}

/**
 * Rough per-condition shell + scalar-fields cost: open the condition
 * editor (menu click), set its scalar fields (one chat input as a
 * reasonable average — most conditions have one configurable value),
 * close the editor. Conditions can't contain nested action lists, so
 * this stays flat per condition.
 */
function conditionRoughUnits(): number {
    return COST.menuClickWait + COST.chatInput + COST.menuClickWait;
}

function conditionListRoughUnits(conditions: readonly Condition[]): number {
    let total = 0;
    for (let i = 0; i < conditions.length; i++) {
        total += conditionRoughUnits();
        if (conditions[i].note !== undefined) total += noteEditUnits();
    }
    return total;
}

export function conditionOperationUnits(
    op: ConditionListDiff["operations"][number]
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "add") {
        let total = conditionRoughUnits();
        if (op.desired.note !== undefined) total += noteEditUnits();
        return total;
    }
    let total = op.noteOnly ? noteEditUnits() : conditionRoughUnits();
    if (op.desired.note !== op.baselineCondition.note) total += noteEditUnits();
    return total;
}

export function conditionListDiffApplyUnits(diff: ConditionListDiff): number {
    let total = 0;
    for (let i = 0; i < diff.operations.length; i++) {
        total += conditionOperationUnits(diff.operations[i]);
    }
    return total;
}

/**
 * Cost of writing one action's payload (scalar fields + any nested
 * action/condition lists) once its shell has been added. Scalar fields
 * each cost a `chatInput`; array fields recurse — `conditions` via
 * `conditionListRoughUnits`, action-list arrays (e.g. `ifActions`,
 * `elseActions`, `actions` for RANDOM) via `actionListRoughApplyUnits`.
 *
 * Recursion terminates because CONDITIONAL/RANDOM aren't allowed to
 * nest — the inner action lists only contain non-CONDITIONAL,
 * non-RANDOM actions, none of which carry action-list arrays.
 *
 * When the action has any writable fields, also includes the
 * `goBackWait` for the `clickGoBack` that `importAction` issues to exit
 * the action editor. Fieldless actions (e.g. Kill Player) take the
 * `Math.max(menuClickWait, total)` floor because `importAction` skips
 * the editor entirely (`if (spec.write)` is false) — they only pay the
 * shell cost.
 */
function actionWriteRoughUnits(action: Action): number {
    let total = 0;
    let hasFields = false;
    const scalarKinds = new Map<string, UiFieldKind>();
    const scalars = getActionScalarLoreFields(action.type);
    for (let i = 0; i < scalars.length; i++) {
        scalarKinds.set(scalars[i].prop, scalars[i].kind);
    }
    for (const key in action) {
        if (key === "type" || key === "note") continue;
        const value = (action as { [key: string]: unknown })[key];
        if (value === undefined) continue;
        hasFields = true;
        if (Array.isArray(value)) {
            if (key === "conditions") {
                total += conditionListRoughUnits(value as Condition[]);
            } else {
                total += actionListRoughApplyUnits(value as Action[]);
            }
            continue;
        }
        const kind = scalarKinds.get(key);
        total += kind !== undefined ? fieldKindEditUnits(kind) : COST.chatInput;
    }
    if (hasFields) total += COST.goBackWait;
    return Math.max(COST.menuClickWait, total);
}

function actionListRoughApplyUnits(actions: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < actions.length; i++) {
        total += actionAddShellUnits() + actionWriteRoughUnits(actions[i]);
        if (actions[i].note !== undefined) total += noteEditUnits();
    }
    return total;
}

export function actionListDiffApplyUnits(
    diff: ActionListDiff,
    editUnitsForFields: (op: Extract<ActionListOperation, { kind: "edit" }>) => number,
    desiredLength: number
): number {
    let total = 0;
    for (let i = 0; i < diff.operations.length; i++) {
        total += actionOperationApplyUnits(
            diff.operations[i],
            editUnitsForFields,
            desiredLength
        );
    }
    return total;
}

export function actionOperationApplyUnits(
    op: ActionListOperation,
    editUnitsForFields: (op: Extract<ActionListOperation, { kind: "edit" }>) => number,
    desiredLength: number
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "move") {
        return moveUnits(op.fromIndex, op.toIndex, desiredLength);
    }
    if (op.kind === "add") {
        let total = actionAddShellUnits() + actionWriteRoughUnits(op.desired);
        total += moveUnits(desiredLength, op.toIndex, desiredLength + 1);
        if (op.desired.note !== undefined) total += noteEditUnits();
        return total;
    }

    let total = op.noteOnly
        ? noteEditUnits()
        : COST.menuClickWait + editUnitsForFields(op) + COST.goBackWait;
    if (op.desired.note !== op.baselineAction.note) total += noteEditUnits();
    return total;
}

/**
 * Per-phase work estimate for a single action-list sync call. `readList` and
 * `applyDiff` emit completed/total units on this shared scale.
 *
 * `readPart` / `hydratePart` cover this list only — nested `syncActionList`
 * calls inside CONDITIONAL/RANDOM bodies aren't separately tracked because
 * their reading is folded into the parent's hydrate phase (via
 * `topLevelHydrateUnits`). `applyPart` does include nested-body apply
 * work via the cache-aware diff recursing one level into
 * `ifActions` / `elseActions` / `actions` (see `editUnitsWithNested`).
 */
/** Sum of the four phase fields. Computed on demand — no cached `total`. */
export function phaseUnitsTotal(p: PhaseUnits): number {
    return p.setup + p.reading + p.hydrating + p.applying;
}

/**
 * Cost of the per-importable setup work that happens BEFORE `syncActionList`
 * is called: shell-creating any referenced functions/menus/regions, then
 * opening the housing editor for this importable (e.g. `/function edit X`,
 * `/region edit X`, item inject + `/edit`, ...). Tracked as its own phase
 * so its wall-clock time doesn't get attributed to "reading" and inflate
 * observed ms/unit.
 */
export function setupUnitsForImportable(importable: Importable): number {
    const refShellUnits = countReferencedShells(importable) * COST.commandMenuWait;
    return refShellUnits + ownSetupUnits(importable);
}

function ownSetupUnits(importable: Importable): number {
    if (importable.type === "FUNCTION") return COST.commandMenuWait;
    if (importable.type === "EVENT") return COST.commandMenuWait + COST.menuClickWait;
    if (importable.type === "REGION") {
        return COST.commandMessageWait * 3 + COST.commandMenuWait;
    }
    if (importable.type === "ITEM") {
        const hasActions =
            (importable.leftClickActions?.length ?? 0) > 0 ||
            (importable.rightClickActions?.length ?? 0) > 0;
        return hasActions
            ? COST.itemInject + COST.commandMenuWait + COST.menuClickWait
            : COST.itemInject;
    }
    if (importable.type === "MENU") return COST.commandMenuWait;
    return COST.commandMenuWait;
}

function topLevelHydrateUnits(desired: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < desired.length; i++) {
        const a = desired[i];
        if (a.type === "CONDITIONAL") {
            total += nestedActionReadUnits(a.ifActions.length);
            total += nestedActionReadUnits(a.elseActions.length);
            if (a.conditions.length > 0) total += COST.menuClickWait + COST.goBackWait;
        } else if (a.type === "RANDOM") {
            total += nestedActionReadUnits(a.actions.length);
        }
    }
    return total;
}

/**
 * Predict per-phase units for a single action-list sync.
 *
 * Two cases, no mixed worldviews:
 *
 * 1. **Baseline current list available** (`baselineCurrent !== undefined`):
 *    use it for read + hydrate estimates, and run the real diff
 *    `baselineCurrent -> desired` to price the apply phase.
 *
 * 2. **No baseline current list** (`baselineCurrent === undefined`): we don't know what the
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
export function estimateActionListPhaseUnits(
    desired: readonly Action[],
    baselineCurrent?: readonly Action[]
): PhaseUnits {
    if (baselineCurrent === undefined) {
        return {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: actionListRoughApplyUnits(desired),
        };
    }
    return {
        setup: 0,
        reading: pageTurnUnitsForListItemCount(baselineCurrent.length),
        hydrating: topLevelHydrateUnits(baselineCurrent),
        applying: baselineAwareApplyUnits(desired, baselineCurrent),
    };
}

export function estimateConditionListPhaseUnits(
    desired: readonly Condition[],
    baselineCurrent?: ReadonlyArray<Condition | null>
): PhaseUnits {
    if (baselineCurrent === undefined) {
        return {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: conditionListRoughUnits(desired),
        };
    }
    const current = baselineConditionListFromConditions(baselineCurrent);
    const diff = diffConditionList(current, desired as Condition[]);
    return {
        setup: 0,
        reading: conditionListReadUnits(baselineCurrent.length),
        hydrating: 0,
        applying: conditionListDiffApplyUnits(diff),
    };
}

/**
 * Compute the apply-phase units for transforming `baseline` -> `desired`,
 * by running the real diff and pricing each operation. Used to tighten
 * ETA estimates when we have a recent baseline for the housing.
 *
 * Returns 0 when baseline and desired are identical (the bar predicts a
 * near-instant pass for this list).
 */
function baselineAwareApplyUnits(
    desired: readonly Action[],
    baseline: readonly Action[]
): number {
    const current = baselineActionListFromActions(baseline);
    const diff = diffActionList(current, desired as Action[]);
    return actionListDiffApplyUnits(diff, editUnitsWithNested, desired.length);
}

/**
 * Edit-op cost for the baseline-aware apply path. Scalar field changes are
 * derived from the edit op's observed/desired pair.
 *
 * `getActionScalarLoreFields` strips out `nestedList` field kinds, so
 * the scalar pass never prices changes to CONDITIONAL.ifActions /
 * elseActions / RANDOM.actions — even though the diff engine still
 * emits an edit op when those bodies differ (its `actionsEqual` does a
 * deep compare). Without this wrapper, a CONDITIONAL whose ifActions
 * grew by 30 actions would be priced as `menuClickWait + 0 + goBackWait`
 * and the bar would silently under-count by the cost of those 30
 * additions, making the live current-unit widening do all
 * the catch-up work.
 *
 * We re-run the diff one level deeper for any CONDITIONAL/RANDOM edit
 * and add the nested apply cost. The HTSL constraint that
 * CONDITIONAL/RANDOM can't appear inside another CONDITIONAL/RANDOM
 * body bounds the recursion at one level.
 */
export function editUnitsWithNested(op: Extract<ActionListOperation, { kind: "edit" }>): number {
    let total = scalarFieldEditUnitsForOp(op);

    for (let i = 0; i < op.nestedDiffs.length; i++) {
        const nested = op.nestedDiffs[i];
        if (nested.diff.operations.length === 0) continue;
        total += COST.menuClickWait + COST.goBackWait;
        if (nested.prop === "conditions") {
            const baseline = nestedConditionBaseline(op.baselineAction);
            const desired = nestedConditionDesired(op.desired);
            total += phaseUnitsTotal(estimateConditionListPhaseUnits(desired, baseline));
        } else {
            const baseline = nestedActionBaseline(op.baselineAction, nested.prop);
            const desired = nestedActionDesired(op.desired, nested.prop);
            total += phaseUnitsTotal(estimateActionListPhaseUnits(desired, baseline));
        }
    }
    return total;
}

function nestedConditionBaseline(
    action: ObservedActionSlot["action"] | Action
): ReadonlyArray<Condition | null> | undefined {
    if (action === null || action.type !== "CONDITIONAL") return undefined;
    return action.conditions;
}

function nestedConditionDesired(action: Action): Condition[] {
    return action.type === "CONDITIONAL" ? action.conditions : [];
}

function nestedActionBaseline(
    action: ObservedActionSlot["action"] | Action,
    prop: "ifActions" | "elseActions" | "actions"
): readonly Action[] | undefined {
    if (action === null) return undefined;
    if (action.type === "CONDITIONAL") {
        const value = prop === "ifActions" ? action.ifActions : action.elseActions;
        return observedActionsAsBaseline(value);
    }
    if (action.type === "RANDOM" && prop === "actions") {
        return observedActionsAsBaseline(action.actions);
    }
    return undefined;
}

function nestedActionDesired(
    action: Action,
    prop: "ifActions" | "elseActions" | "actions"
): readonly Action[] {
    if (action.type === "CONDITIONAL") {
        return prop === "ifActions" ? action.ifActions : action.elseActions;
    }
    if (action.type === "RANDOM" && prop === "actions") return action.actions;
    return [];
}

function observedActionsAsBaseline(
    actions: ReadonlyArray<ObservedActionSlot["action"] | Action> | undefined
): readonly Action[] | undefined {
    if (actions === undefined) return undefined;
    const out: Action[] = [];
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (action !== null) out.push(action as Action);
    }
    return out;
}

/**
 * Total work for one action-list sync (read + hydrate + apply). Wraps
 * `estimateActionListPhaseUnits`'s three parts back into a single
 * number. Used by `estimateImportableCost`.
 */
function actionListCost(
    desired: readonly Action[],
    baselineCurrent: readonly Action[] | undefined
): number {
    return phaseUnitsTotal(estimateActionListPhaseUnits(desired, baselineCurrent));
}

/**
 * Total work estimate for one importable in units. The optional
 * `getCached(basePath)` callback returns the last-known cached actions
 * for the importable's action-list fields (e.g. `"actions"`,
 * `"onEnterActions"`). Pass `undefined` for the no-cache path; phase
 * estimates fall back to "assume housing is empty" → predict only the
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
            COST.cacheWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(importable.actions, get("actions")) +
            COST.cacheWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandMessageWait * 3 +
            COST.commandMenuWait +
            actionListCost(importable.onEnterActions ?? [], get("onEnterActions")) +
            actionListCost(importable.onExitActions ?? [], get("onExitActions")) +
            COST.cacheWrite
        );
    }
    if (importable.type === "ITEM") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        if (left.length === 0 && right.length === 0) {
            return COST.itemInject + COST.cacheWrite;
        }
        return (
            COST.itemInject +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(left, get("leftClickActions")) +
            actionListCost(right, get("rightClickActions")) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.cacheWrite
        );
    }
    if (importable.type === "MENU") {
        return (
            COST.commandMenuWait +
            (importable.slots?.length ?? 0) * COST.menuClickWait +
            COST.cacheWrite
        );
    }
    return COST.commandMenuWait + COST.cacheWrite;
}
