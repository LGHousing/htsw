import type { Action, Condition, Importable } from "htsw/types";

import type { ActionHydrationWork, ActionHydrationPlan } from "../actions/hydration/plan";
import type {
    ActionListDiff,
    ActionListOperation,
    ConditionListDiff,
} from "../actions/diff/types";
import type { ChildListName } from "../actionPath";
import type { ObservedActionSlot } from "../observedActions";
import type { UiFieldKind } from "../fields/loreSpecs";
import type { PhaseUnits } from "./types";
export type { PhaseUnits };
import { baselineActionListFromActions, diffActionList } from "../actions/diff";
import {
    baselineConditionListFromConditions,
    diffConditionList,
} from "../actions/conditions/diff";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { getConditionScalarLoreFields } from "../fields/conditionMappings";
import { isTruncatableKind } from "../fields/loreParsing";
import {
    scalarFieldDiffers,
    normalizeActionCompare,
    normalizeConditionCompare,
} from "../fields/compare";
import { countReferencedShells } from "../../importables/referenceScanner";
import { readCachedActionList } from "../../importCache/actionLists";
import type { ImportableCacheEntry } from "../../importCache/cache";

/**
 * Per-op-kind costs in abstract units. Calibrated against
 * `guaranteedSleep1000 = 4` as the 1-second anchor, so 1 unit ≈ 250ms.
 *
 * Costs are tuned so each kind's *real* avg ms / unit lands close to a
 * common ~250 ms/u band — that way ETA projections stay accurate even
 * when an importable's op mix is skewed (e.g. lots of `itemSelect` vs
 * lots of `anvilInput`). When a per-op ms/u drifts noticeably from the
 * band, bump the cost to compensate. Latest sample basis (n=samples):
 *   commandMenuWait 2.3 (n=214 @ 585ms → ~254 ms/u)
 *   menuClickWait 1.7   (n=3414 @ 430ms → ~253 ms/u)
 *   pageTurnWait 1.7    (n=222 @ 427ms → ~251 ms/u)
 *   goBackWait 1.8      (n=3422 @ 451ms → ~251 ms/u)
 *   chatInput 3.0       (n=846 @ 751ms → ~250 ms/u)
 *   anvilInput 3.8      (n=11 @ 937ms → ~247 ms/u)
 *   itemSelect 1.6      (n=54 @ 388ms → ~243 ms/u)
 *   reorderStep 1.8     (n=145 @ 454ms → ~252 ms/u)
 *
 * Re-tune via `/htsw eta`, then divide each kind's `avgMs` by the
 * target band rate to get the new unit value.
 */
export const COST = {
    commandInterval: 1,
    commandMenuWait: 2.3,
    commandMessageWait: 2,

    menuClickWait: 1.7,
    messageClickWait: 2,
    pageTurnWait: 1.7,
    goBackWait: 1.8,

    chatInput: 3,
    signInput: 3,
    anvilInput: 3.8,
    itemSelect: 1.6,

    reorderStep: 1.8,
    guaranteedSleep1000: 4,

    readVisiblePage: 0,
    scalarRead: 0,
    cacheWrite: 0.25,
    nbtCapture: 0.25,
    itemInject: 1,
};

/**
 * One captured item field inside an open editor: click the field to open the
 * item picker, copy the current item, then click back — see
 * `captureItemFromOpenEditorField`.
 */
export const ITEM_CAPTURE_FIELD_UNITS =
    COST.menuClickWait + COST.itemSelect + COST.goBackWait;

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
    if (kind === "actionList" || kind === "conditionList") {
        return COST.menuClickWait;
    }
    return COST.menuClickWait;
}

function scalarFieldEditUnitsForOp(
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

/**
 * Cost to read one child list: open the field, page through it, go back —
 * plus, when the rows' types are known, one editor round trip for every row
 * whose type carries a truncatable field. Neither content nor a lore summary
 * can tell which values will actually render truncated (only the read can),
 * so the per-type charge is a deliberate over-estimate that live discovery
 * trues up. Both the content-based estimates and the observed-plan pricing
 * go through here — keep them agreeing by construction.
 */
function childListUnits(count: number, rowTypes?: readonly string[]): number {
    let total =
        COST.menuClickWait + pageTurnUnitsForListItemCount(count) + COST.goBackWait;
    if (rowTypes !== undefined) {
        for (let i = 0; i < rowTypes.length; i++) {
            if (typeMaybeNeedsScalarHydrate(rowTypes[i])) {
                total += COST.menuClickWait + COST.goBackWait;
            }
        }
    }
    return total;
}

export function hydrationEntryUnits(
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    includeSpeculativeChildRowScalarHydrate: boolean = true
): number {
    if (entry.action === null) return 0;

    let total = COST.menuClickWait + COST.goBackWait;
    work.childListsToRead.forEach((prop) => {
        total += childListReadUnits(entry, prop, includeSpeculativeChildRowScalarHydrate);
    });
    total += work.itemFieldsToCapture.length * ITEM_CAPTURE_FIELD_UNITS;
    return total;
}

export function exactHydrationPlanUnits(plan: ActionHydrationPlan): number {
    let total = 0;
    plan.forEach((work, entry) => {
        total += hydrationEntryUnits(entry, work, false);
    });
    return total;
}

export function childListReadUnits(
    entry: ObservedActionSlot,
    prop: ChildListName,
    includeSpeculativeChildRowScalarHydrate: boolean = true
): number {
    const summary = entry.childListSummaries ? entry.childListSummaries[prop] : undefined;
    if (summary === undefined) return childListUnits(1);
    // Condition rows hydrate by observed value, not type (see
    // readConditionList), so they get no per-type scalar charge here.
    return childListUnits(
        summary.length,
        includeSpeculativeChildRowScalarHydrate && prop !== "conditions"
            ? summary
            : undefined
    );
}

function typeMaybeNeedsScalarHydrate(typeName: string): boolean {
    const fields = getActionScalarLoreFields(typeName as Action["type"]);
    if (fields.length === 0) return false;
    for (let i = 0; i < fields.length; i++) {
        if (isTruncatableKind(fields[i].kind)) return true;
    }
    return false;
}

function noteEditUnits(): number {
    return COST.chatInput;
}

/**
 * Per-add shell cost: what `addAction` does *outside* the field-write
 * loop — click "Add Action", click the action-type slot. No page-turn term:
 * the add menu opens on page 1 and the common action types are there, so
 * `getSlotPaginate` usually does zero turns; charging a guaranteed turn
 * over-counts every add. The post-write `clickGoBack` is priced inside
 * `actionWriteRoughUnits` instead, since fieldless actions skip the editor.
 */
function actionAddShellUnits(): number {
    return COST.menuClickWait + COST.menuClickWait;
}

function conditionScalarFieldWriteUnits(condition: Condition): number {
    const normalized = normalizeConditionCompare(condition) as {
        [key: string]: unknown;
    } | null;
    if (normalized === null) return 0;
    const kinds = new Map<string, UiFieldKind>();
    const fields = getConditionScalarLoreFields(condition.type);
    for (let i = 0; i < fields.length; i++) kinds.set(fields[i].prop, fields[i].kind);
    let total = 0;
    for (const key in normalized) {
        if (key === "type" || key === "note" || key === "inverted") continue;
        if (normalized[key] === undefined) continue;
        const kind = kinds.get(key);
        total += kind !== undefined ? fieldKindEditUnits(kind) : COST.chatInput;
    }
    return total;
}

function conditionAddUnits(condition: Condition): number {
    let total = COST.menuClickWait + COST.menuClickWait + COST.goBackWait;
    total += conditionScalarFieldWriteUnits(condition);
    if (condition.inverted === true) total += COST.menuClickWait;
    return total;
}

function conditionEditUnits(baseline: Condition, desired: Condition): number {
    let total = COST.menuClickWait + COST.goBackWait;
    const fields = getConditionScalarLoreFields(desired.type);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (scalarFieldDiffers(baseline, desired, desired.type, field.prop)) {
            total += fieldKindEditUnits(field.kind);
        }
    }
    if ((baseline.inverted === true) !== (desired.inverted === true)) {
        total += COST.menuClickWait;
    }
    return total;
}

function conditionListRoughUnits(conditions: readonly Condition[]): number {
    let total = 0;
    for (let i = 0; i < conditions.length; i++) {
        total += conditionAddUnits(conditions[i]);
        if (conditions[i].note !== undefined) total += noteEditUnits();
    }
    return total;
}

export function conditionOperationUnits(
    op: ConditionListDiff["operations"][number]
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "add") {
        let total = conditionAddUnits(op.desired);
        if (op.desired.note !== undefined) total += noteEditUnits();
        return total;
    }
    let total = op.noteOnly
        ? noteEditUnits()
        : conditionEditUnits(op.baselineCondition, op.desired);
    if (!op.noteOnly && op.desired.note !== op.baselineCondition.note) {
        total += noteEditUnits();
    }
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
 * Cost of writing one action's payload (scalar fields + any child-list
 * action/condition lists) once its shell has been added. Scalar fields
 * each cost a `chatInput`; array fields recurse — `conditions` via
 * `conditionListRoughUnits`, action-list arrays (e.g. `ifActions`,
 * `elseActions`, `actions` for RANDOM) via `actionListRoughApplyUnits`.
 *
 * Recursion terminates because CONDITIONAL/RANDOM aren't allowed to
 * nest — the child action lists only contain non-CONDITIONAL,
 * non-RANDOM actions, none of which carry action-list arrays.
 *
 * When the action has any writable fields, also includes the
 * `goBackWait` for the `clickGoBack` that `addAction` issues to exit
 * the action editor. Fieldless actions (e.g. Kill Player) take the
 * `Math.max(menuClickWait, total)` floor because `addAction` skips
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
    // Normalize first: the writer short-circuits any field already at its
    // (freshly-added) default, sending no input. `normalizeActionCompare`
    // drops exactly those default-valued fields — the same rule the diff
    // uses — so iterating the normalized action counts only the fields that
    // are actually written. Single source of truth, no parallel default check.
    const normalized = normalizeActionCompare(action) as { [key: string]: unknown };
    for (const key in normalized) {
        if (key === "type" || key === "note") continue;
        const value = normalized[key];
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
    if (!op.noteOnly && op.desired.note !== op.baselineAction.note) {
        total += noteEditUnits();
    }
    return total;
}

/**
 * Per-phase work estimate for a single action-list sync call. `readList` and
 * apply phases emit completed/total units on this shared scale.
 *
 * `readPart` / `hydratePart` cover this list only — child action-list apply
 * calls inside CONDITIONAL/RANDOM bodies aren't separately tracked because
 * their reading is folded into the parent's hydrate phase (via
 * `topLevelHydrateUnits`). `applyPart` does include child-list apply
 * work via the cache-aware diff recursing one level into
 * `ifActions` / `elseActions` / `actions` (see `editUnitsWithChildLists`).
 */
/** Sum of the four phase fields. Computed on demand — no cached `total`. */
export function phaseUnitsTotal(p: PhaseUnits): number {
    return p.setup + p.reading + p.hydrating + p.applying;
}

/**
 * Cost of the per-importable setup work that happens before action-list work
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
    if (importable.type === "COMMAND") return COST.commandMenuWait;
    if (importable.type === "EVENT") return COST.commandMenuWait + COST.menuClickWait;
    if (importable.type === "REGION") {
        return COST.commandMessageWait * 3 + COST.commandMenuWait;
    }
    if (importable.type === "NPC") {
        return COST.commandMenuWait + COST.menuClickWait * 3;
    }
    if (importable.type === "ITEM") {
        const hasActions =
            (importable.leftClickActions?.length ?? 0) > 0 ||
            (importable.rightClickActions?.length ?? 0) > 0;
        // A codeless item is skipped, not spawned, so it has no setup work.
        return hasActions
            ? COST.itemInject + COST.commandMenuWait + COST.menuClickWait
            : 0;
    }
    if (importable.type === "MENU") return COST.commandMenuWait;
    return COST.commandMenuWait;
}

/**
 * Hydrate-phase estimate for a list whose full content is known (cached
 * baseline, menu slot): the same shape the live plan prices — one editor
 * round trip per CONDITIONAL/RANDOM entry plus `childListUnits` per
 * non-empty child list. The reader never enters an empty child list (its
 * lore summary reads "None"), so empty branches cost nothing here either.
 * A conditional parsed from .htsl may omit a branch entirely, leaving the
 * field undefined — guard every length read.
 */
function topLevelHydrateUnits(desired: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < desired.length; i++) {
        const a = desired[i];
        let lists = 0;
        if (a.type === "CONDITIONAL") {
            lists += knownChildListUnits(a.ifActions);
            lists += knownChildListUnits(a.elseActions);
            const conditionCount = a.conditions?.length ?? 0;
            if (conditionCount > 0) lists += childListUnits(conditionCount);
        } else if (a.type === "RANDOM") {
            lists += knownChildListUnits(a.actions);
        }
        if (lists > 0) total += COST.menuClickWait + COST.goBackWait + lists;
    }
    return total;
}

function knownChildListUnits(actions: readonly Action[] | undefined): number {
    if (actions === undefined || actions.length === 0) return 0;
    const types: string[] = [];
    for (let i = 0; i < actions.length; i++) types.push(actions[i].type);
    return childListUnits(actions.length, types);
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
        // No cache: we don't know what's in housing yet, so the read and
        // hydrate costs are unknowable upfront. They get filled in with
        // exact values from observed `childListSummaries` once the read
        // pass finishes (hydration/run.ts:hydrateActionDetails). The UI's
        // never-jump-up ETA guard masks the one-time totalUnits step at
        // the read→hydrate transition.
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
    return actionListDiffApplyUnits(diff, editUnitsWithChildLists, desired.length);
}

/**
 * Edit-op cost for the baseline-aware apply path. Scalar field changes are
 * derived from the edit op's observed/desired pair.
 *
 * `getActionScalarLoreFields` strips out `childList` field kinds, so
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
 * and add the child apply cost. The HTSL constraint that
 * CONDITIONAL/RANDOM can't appear inside another CONDITIONAL/RANDOM
 * body bounds the recursion at one level.
 */
export function editUnitsWithChildLists(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    let total = scalarFieldEditUnitsForOp(op);

    for (let i = 0; i < op.childListDiffs.length; i++) {
        const childList = op.childListDiffs[i];
        if (childList.diff.operations.length === 0) continue;
        total += COST.menuClickWait + COST.goBackWait;
        if (childList.prop === "conditions") {
            const baseline = childConditionBaseline(op.baselineAction);
            const desired = childConditionDesired(op.desired);
            total += phaseUnitsTotal(estimateConditionListPhaseUnits(desired, baseline));
        } else {
            const baseline = childActionBaseline(op.baselineAction, childList.prop);
            const desired = childActionDesired(op.desired, childList.prop);
            total += phaseUnitsTotal(estimateActionListPhaseUnits(desired, baseline));
        }
    }
    return total;
}

function childConditionBaseline(
    action: ObservedActionSlot["action"] | Action
): ReadonlyArray<Condition | null> | undefined {
    if (action === null || action.type !== "CONDITIONAL") return undefined;
    return action.conditions;
}

function childConditionDesired(action: Action): Condition[] {
    return action.type === "CONDITIONAL" ? (action.conditions ?? []) : [];
}

function childActionBaseline(
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

function childActionDesired(
    action: Action,
    prop: "ifActions" | "elseActions" | "actions"
): readonly Action[] {
    if (action.type === "CONDITIONAL") {
        return (prop === "ifActions" ? action.ifActions : action.elseActions) ?? [];
    }
    if (action.type === "RANDOM" && prop === "actions") return action.actions ?? [];
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
    baselineCurrent: readonly Action[] | undefined,
    trustedBaseline: boolean = false
): number {
    if (trustedBaseline) {
        return baselineAwareApplyUnits(desired, baselineCurrent ?? []);
    }
    return phaseUnitsTotal(estimateActionListPhaseUnits(desired, baselineCurrent));
}

function actionListReadCost(actions: readonly Action[]): number {
    return (
        COST.menuClickWait +
        pageTurnUnitsForListItemCount(actions.length) +
        topLevelHydrateUnitsExact(actions) +
        COST.goBackWait
    );
}

function topLevelHydrateUnitsExact(actions: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        let lists = 0;
        if (action.type === "CONDITIONAL") {
            lists += exactKnownChildListUnits(action.ifActions);
            lists += exactKnownChildListUnits(action.elseActions);
            if ((action.conditions?.length ?? 0) > 0)
                lists += childListUnits(action.conditions!.length);
        } else if (action.type === "RANDOM") {
            lists += exactKnownChildListUnits(action.actions);
        }
        if (lists > 0) total += COST.menuClickWait + COST.goBackWait + lists;
    }
    return total;
}

function exactKnownChildListUnits(actions: readonly Action[] | undefined): number {
    return actions === undefined || actions.length === 0
        ? 0
        : childListUnits(actions.length);
}

export function estimateImportableReadUnits(importable: Importable): number {
    if (importable.type === "FUNCTION") {
        return (
            COST.commandMenuWait +
            actionListReadCost(importable.actions ?? []) +
            COST.menuClickWait +
            COST.goBackWait +
            COST.cacheWrite
        );
    }
    if (importable.type === "COMMAND") {
        return (
            COST.commandMenuWait +
            actionListReadCost(importable.actions ?? []) +
            COST.menuClickWait +
            COST.cacheWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListReadCost(importable.actions) +
            COST.cacheWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandMessageWait * 3 +
            COST.commandMenuWait +
            actionListReadCost(importable.onEnterActions ?? []) +
            actionListReadCost(importable.onExitActions ?? []) +
            COST.cacheWrite
        );
    }
    if (importable.type === "ITEM") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        if (left.length === 0 && right.length === 0) return COST.cacheWrite;
        return (
            COST.itemInject +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListReadCost(left) +
            actionListReadCost(right) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.cacheWrite
        );
    }
    if (importable.type === "MENU") {
        let total = COST.commandMenuWait + COST.menuClickWait;
        const slots = importable.slots ?? [];
        for (let i = 0; i < slots.length; i++) {
            total += actionListReadCost(slots[i].actions ?? []);
        }
        return total + COST.cacheWrite;
    }
    if (importable.type === "NPC") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait * 3 +
            COST.chatInput +
            (importable.leftClickRedirect === undefined ? 0 : COST.menuClickWait) +
            actionListReadCost(importable.leftClickActions ?? []) +
            actionListReadCost(importable.rightClickActions ?? []) +
            COST.cacheWrite
        );
    }
    return COST.commandMenuWait + COST.cacheWrite;
}

/**
 * Total work estimate for one importable in units. The optional
 * `getCached(basePath)` callback returns the last-known cached actions
 * for the importable's action-list fields (e.g. `"actions"`,
 * `"onEnterActions"`). Pass `undefined` for the no-cache path; phase
 * estimates fall back to "assume housing is empty" → predict only the
 * worst-case apply work.
 *
 * MENU is priced as the per-slot editor walk (both directions do one);
 * it ignores `getCached` — slot action lists live at per-slot paths the
 * cache lookup doesn't model.
 */
export function estimateImportableCost(
    importable: Importable,
    getCached?: (basePath: string) => readonly Action[] | undefined,
    trustMode: boolean = false
): number {
    const get = (path: string): readonly Action[] | undefined =>
        getCached === undefined ? undefined : getCached(path);
    const trustedBaseline = trustMode && getCached !== undefined;

    if (importable.type === "FUNCTION") {
        return (
            COST.commandMenuWait +
            actionListCost(importable.actions ?? [], get("actions"), trustedBaseline) +
            COST.cacheWrite
        );
    }
    if (importable.type === "COMMAND") {
        const settingsUnits =
            fieldKindEditUnits("cycle") + COST.signInput + fieldKindEditUnits("boolean");
        return (
            COST.commandMenuWait +
            actionListCost(importable.actions ?? [], get("actions"), trustedBaseline) +
            settingsUnits +
            COST.cacheWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(importable.actions, get("actions"), trustedBaseline) +
            COST.cacheWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandMessageWait * 3 +
            COST.commandMenuWait +
            actionListCost(
                importable.onEnterActions ?? [],
                get("onEnterActions"),
                trustedBaseline
            ) +
            actionListCost(
                importable.onExitActions ?? [],
                get("onExitActions"),
                trustedBaseline
            ) +
            COST.cacheWrite
        );
    }
    if (importable.type === "ITEM") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        if (left.length === 0 && right.length === 0) {
            // Codeless items are skipped (issue #56), not spawned — only the
            // cache write remains. estimateImportableUnits floors this at 1.
            return COST.cacheWrite;
        }
        return (
            COST.itemInject +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(left, get("leftClickActions"), trustedBaseline) +
            actionListCost(right, get("rightClickActions"), trustedBaseline) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.cacheWrite
        );
    }
    if (importable.type === "MENU") {
        // A menu is walked slot by slot: export and the import preread both
        // LEFT-click into every populated slot's action editor, deep-read its
        // list, and go back (see readLiveMenu). Price that walk per slot;
        // pricing only the click (as this branch once did) undercounts a
        // menu's work by the entire cost of its action lists.
        let total = COST.commandMenuWait + COST.menuClickWait;
        const slots = importable.slots ?? [];
        for (let i = 0; i < slots.length; i++) {
            const actions = slots[i].actions ?? [];
            total +=
                COST.menuClickWait +
                pageTurnUnitsForListItemCount(actions.length) +
                topLevelHydrateUnits(actions) +
                COST.goBackWait;
        }
        return total + COST.cacheWrite;
    }
    if (importable.type === "NPC") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        const redirectUnits =
            importable.leftClickRedirect === undefined ? 0 : COST.menuClickWait;
        const renameUnits = COST.chatInput;
        return (
            COST.commandMenuWait +
            COST.menuClickWait * 3 +
            renameUnits +
            redirectUnits +
            actionListCost(left, get("leftClickActions"), trustedBaseline) +
            actionListCost(right, get("rightClickActions"), trustedBaseline) +
            COST.cacheWrite
        );
    }
    return COST.commandMenuWait + COST.cacheWrite;
}

/**
 * Work estimate in units for one importable, given its last-known saved
 * state (or null when there's none). When a saved state exists, its action
 * lists feed the cache-aware estimate so unchanged work is priced cheaply.
 */
export function estimateImportableUnits(
    importable: Importable,
    cacheEntry: ImportableCacheEntry | null,
    trustMode: boolean = false
): number {
    if (cacheEntry === null) {
        // Floor at 1: a 0-unit item would otherwise read as already-done.
        return Math.max(1, estimateImportableCost(importable));
    }
    const getCached = (basePath: string) =>
        readCachedActionList(cacheEntry.importable, basePath);
    return Math.max(1, estimateImportableCost(importable, getCached, trustMode));
}
