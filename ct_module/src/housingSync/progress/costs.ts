import type { Action, Condition, Importable } from "htsw/types";

import type { ActionHydrationWork, ActionHydrationPlan } from "../actions/hydration/plan";
import type {
    ActionListOperation,
    ChildActionListDiff,
    ConditionListDiff,
    ConditionListOperation,
    ChildListDiff,
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
import {
    ACTION_MAPPINGS,
    getActionLoreFields,
    getActionScalarLoreFields,
    getChildListFields,
} from "../fields/actionMappings";
import {
    CONDITION_MAPPINGS,
    getConditionScalarLoreFields,
} from "../fields/conditionMappings";
import { isTruncatableKind } from "../fields/loreParsing";
import {
    scalarFieldDiffers,
    scalarFieldHasNonDefaultValue,
    notesEqual,
} from "../actions/comparison";
import { readCachedActionList } from "../../importCache/actionLists";
import type { ImportableCacheEntry } from "../../importCache/cache";
import { actionHash } from "../../importCache/hash";
import { matchByHash } from "../../importCache/actionMatch";
import { cacheEntryListHashes } from "../../importCache/status";
import { trustedChildListPathsForImportable } from "../../importCache/trust";
import { regionBoundsEqual } from "../../importables/regions/bounds";

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

export const REGION_BOUNDS_CHANGE_UNITS =
    (COST.commandInterval + COST.commandMessageWait) * 4 +
    (COST.commandInterval + COST.commandMenuWait) * 2 +
    COST.messageClickWait;

const LIST_ITEMS_PER_PAGE = 21;

function pagesForListItemCount(count: number): number {
    return Math.max(1, Math.ceil(Math.max(0, count) / LIST_ITEMS_PER_PAGE));
}

function pageTurnUnitsForListItemCount(count: number): number {
    return Math.max(0, pagesForListItemCount(count) - 1) * COST.pageTurnWait;
}

function cycleEditUnits(
    options: readonly string[],
    current: unknown,
    desired: unknown
): number {
    if (typeof current !== "string") {
        return Math.floor(options.length / 2) * COST.menuClickWait;
    }
    const currentIndex = options.indexOf(current);
    const desiredIndex = options.indexOf(desired as string);
    const left = (desiredIndex - currentIndex + options.length) % options.length;
    const right = (currentIndex - desiredIndex + options.length) % options.length;
    return Math.min(left, right) * COST.menuClickWait;
}

function actionFieldOptions(
    type: Action["type"],
    prop: string
): readonly string[] | undefined {
    const fields = ACTION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; options?: readonly string[] }
    >;
    for (const label in fields) {
        if (fields[label].prop === prop) return fields[label].options;
    }
    return undefined;
}

function conditionFieldOptions(
    type: Condition["type"],
    prop: string
): readonly string[] | undefined {
    const fields = CONDITION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; options?: readonly string[] }
    >;
    for (const label in fields) {
        if (fields[label].prop === prop) return fields[label].options;
    }
    return undefined;
}

function fieldKindEditUnits(
    kind: UiFieldKind,
    options?: readonly string[],
    current?: unknown,
    desired?: unknown
): number {
    if (kind === "boolean") return COST.menuClickWait;
    if (kind === "cycle") {
        return cycleEditUnits(options as readonly string[], current, desired);
    }
    if (kind === "select" || kind === "location") {
        return COST.menuClickWait + COST.menuClickWait;
    }
    if (kind === "item") {
        return COST.menuClickWait + COST.itemSelect + COST.itemInject;
    }
    if (kind === "value") return COST.chatInput;
    if (kind === "actionList") {
        return COST.menuClickWait;
    }
    return COST.menuClickWait;
}

function commandSettingsUnits(
    desired: Extract<Importable, { type: "COMMAND" }>,
    current?: Extract<Importable, { type: "COMMAND" }>
): number {
    const desiredMode = desired.mode ?? "Self";
    const desiredPriority = desired.requiredPriority ?? 0;
    const desiredListed = desired.listed ?? true;
    if (current === undefined) {
        return (
            fieldKindEditUnits("cycle", ["Self", "Targeted"]) +
            COST.signInput +
            fieldKindEditUnits("boolean")
        );
    }

    let total = 0;
    if ((current.mode ?? "Self") !== desiredMode) {
        total += fieldKindEditUnits(
            "cycle",
            ["Self", "Targeted"],
            current.mode ?? "Self",
            desiredMode
        );
    }
    if ((current.requiredPriority ?? 0) !== desiredPriority) {
        total += COST.signInput;
    }
    if ((current.listed ?? true) !== desiredListed) {
        total += fieldKindEditUnits("boolean");
    }
    return total;
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
            total += fieldKindEditUnits(
                field.kind,
                actionFieldOptions(action.type, field.prop),
                (action as unknown as Record<string, unknown>)[field.prop],
                (op.desired as unknown as Record<string, unknown>)[field.prop]
            );
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

function pageForIndex(index: number): number {
    return Math.floor(index / LIST_ITEMS_PER_PAGE) + 1;
}

function visitIndexUnits(currentPage: { value: number }, index: number): number {
    const targetPage = pageForIndex(index);
    const units = Math.abs(targetPage - currentPage.value) * COST.pageTurnWait;
    currentPage.value = targetPage;
    return units;
}

function itemFieldCount(fields: Record<string, { kind: UiFieldKind }>): number {
    let count = 0;
    for (const label in fields) {
        if (fields[label].kind === "item") count++;
    }
    return count;
}

function actionItemFieldCount(type: Action["type"]): number {
    return itemFieldCount(getActionLoreFields(type));
}

function conditionItemFieldCount(type: Condition["type"]): number {
    return itemFieldCount(CONDITION_MAPPINGS[type].loreFields);
}

function conditionItemHydrationUnits(
    conditions: ReadonlyArray<Condition | null>
): number {
    let total = 0;
    for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        if (condition === null) continue;
        const fields = conditionItemFieldCount(condition.type);
        if (fields > 0) {
            total +=
                COST.menuClickWait +
                COST.goBackWait +
                fields * ITEM_CAPTURE_FIELD_UNITS;
        }
    }
    return total;
}

function conditionListReadUnits(conditions: ReadonlyArray<Condition | null>): number {
    return (
        pageTurnUnitsForListItemCount(conditions.length) +
        conditionItemHydrationUnits(conditions)
    );
}

function conditionChildListUnits(conditions: readonly Condition[]): number {
    return (
        childListUnits(conditions.length) + conditionItemHydrationUnits(conditions)
    );
}

/**
 * Cost to read one child list: open the field, page through it, go back —
 * plus known item-field capture work. When requested, it also includes one
 * editor round trip for every row whose type carries a truncatable field.
 * Neither content nor a lore summary can tell which values will actually
 * render truncated (only the read can), so the per-type charge is a deliberate
 * over-estimate that live discovery trues up.
 */
function childListUnits(
    count: number,
    rowTypes?: readonly string[],
    includeSpeculativeScalarHydrate: boolean = true
): number {
    let total =
        COST.menuClickWait + pageTurnUnitsForListItemCount(count) + COST.goBackWait;
    if (rowTypes !== undefined) {
        for (let i = 0; i < rowTypes.length; i++) {
            const itemFields = actionItemFieldCount(rowTypes[i] as Action["type"]);
            if (
                itemFields > 0 ||
                (includeSpeculativeScalarHydrate &&
                    typeMaybeNeedsScalarHydrate(rowTypes[i]))
            ) {
                total += COST.menuClickWait + COST.goBackWait;
            }
            total += itemFields * ITEM_CAPTURE_FIELD_UNITS;
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

function noteEditUnits(note: string | undefined): number {
    return (
        (note === undefined ? COST.chatInput : COST.anvilInput) +
        COST.menuClickWait
    );
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
    const fields = getConditionScalarLoreFields(condition.type);
    let total = 0;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (
            scalarFieldHasNonDefaultValue(
                condition,
                condition.type,
                field.prop
            )
        ) {
            total += fieldKindEditUnits(
                field.kind,
                conditionFieldOptions(condition.type, field.prop),
                undefined,
                (condition as unknown as Record<string, unknown>)[field.prop]
            );
        }
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
            total += fieldKindEditUnits(
                field.kind,
                conditionFieldOptions(desired.type, field.prop),
                (baseline as unknown as Record<string, unknown>)[field.prop],
                (desired as unknown as Record<string, unknown>)[field.prop]
            );
        }
    }
    if ((baseline.inverted === true) !== (desired.inverted === true)) {
        total += COST.menuClickWait;
    }
    return total;
}

function conditionOperationBaseUnits(
    op: ConditionListDiff["operations"][number]
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "add") {
        let total = conditionAddUnits(op.desired);
        if (op.desired.note !== undefined) total += noteEditUnits(op.desired.note);
        return total;
    }
    let total = op.noteOnly
        ? noteEditUnits(op.desired.note)
        : conditionEditUnits(op.baselineCondition, op.desired);
    if (!op.noteOnly && !notesEqual(op.desired.note, op.baselineCondition.note)) {
        total += noteEditUnits(op.desired.note);
    }
    return total;
}

export function conditionOperationUnits(
    op: ConditionListDiff["operations"][number],
    plannedUnits?: ReadonlyMap<ConditionListDiff["operations"][number], number>
): number {
    return plannedUnits?.get(op) ?? conditionOperationBaseUnits(op);
}

export function conditionListDiffApplyUnits(diff: ConditionListDiff): number {
    const units = conditionListOperationApplyUnits(diff);
    let total = 0;
    units.forEach((value) => (total += value));
    return total;
}

export function conditionListOperationApplyUnits(
    diff: ConditionListDiff
): Map<ConditionListOperation, number> {
    const result = new Map<ConditionListOperation, number>();
    let observedCount = 0;
    for (const op of diff.operations) {
        if (op.kind !== "add") observedCount = Math.max(observedCount, op.entryId + 1);
    }
    const current: number[] = [];
    for (let i = 0; i < observedCount; i++) current.push(i);
    const currentPage = { value: 1 };
    const edits = diff.operations.filter(
        (op): op is Extract<ConditionListOperation, { kind: "edit" }> =>
            op.kind === "edit"
    );
    const deletes = diff.operations
        .filter(
            (op): op is Extract<ConditionListOperation, { kind: "delete" }> =>
                op.kind === "delete"
        )
        .sort((a, b) => current.indexOf(b.entryId) - current.indexOf(a.entryId));
    const adds = diff.operations.filter(
        (op): op is Extract<ConditionListOperation, { kind: "add" }> =>
            op.kind === "add"
    );

    for (const op of [...edits, ...deletes, ...adds]) {
        let units = conditionOperationBaseUnits(op);
        if (op.kind !== "add") {
            const index = current.indexOf(op.entryId);
            units += visitIndexUnits(currentPage, index);
            if (op.kind === "delete") current.splice(index, 1);
        }
        result.set(op, units);
    }
    return result;
}

function actionWriteUnits(
    action: Action,
    childListDiffs: readonly ChildListDiff[]
): number {
    let total = 0;
    const scalars = getActionScalarLoreFields(action.type);
    for (let i = 0; i < scalars.length; i++) {
        const field = scalars[i];
        if (
            !scalarFieldHasNonDefaultValue(
                action,
                action.type,
                field.prop
            )
        ) {
            continue;
        }
        total += fieldKindEditUnits(
                field.kind,
                actionFieldOptions(action.type, field.prop),
                undefined,
                (action as unknown as Record<string, unknown>)[field.prop]
            );
    }

    for (let i = 0; i < childListDiffs.length; i++) {
        const childList = childListDiffs[i];
        if (childList.diff.operations.length === 0) continue;
        if (childList.kind === "conditions") {
            total +=
                COST.menuClickWait +
                conditionListDiffApplyUnits(childList.diff) +
                COST.goBackWait;
        } else {
            total +=
                COST.menuClickWait +
                childActionListDiffApplyUnits(childList.diff) +
                COST.goBackWait;
        }
    }
    if (scalars.length > 0 || getChildListFields(action.type).length > 0) {
        total += COST.goBackWait;
    }
    return total;
}

export function actionListDiffApplyUnits<
    TOperation extends ActionListOperation,
>(
    diff: { operations: TOperation[]; desiredLength: number },
    editUnitsForFields: (
        op: Extract<TOperation, { kind: "edit" }>
    ) => number,
    desiredLength: number
): number {
    const units = actionListOperationApplyUnits(
        diff,
        editUnitsForFields,
        desiredLength
    );
    let total = 0;
    units.forEach((value) => (total += value));
    return total;
}

export function actionListOperationApplyUnits<
    TOperation extends ActionListOperation,
>(
    diff: { operations: TOperation[]; desiredLength: number },
    editUnitsForFields: (
        op: Extract<TOperation, { kind: "edit" }>
    ) => number,
    desiredLength: number
): Map<TOperation, number> {
    const result = new Map<TOperation, number>();
    const addCount = diff.operations.filter((op) => op.kind === "add").length;
    const deleteCount = diff.operations.filter((op) => op.kind === "delete").length;
    const observedLength = desiredLength - addCount + deleteCount;
    const current: number[] = [];
    for (let i = 0; i < observedLength; i++) current.push(i);
    let nextEntryId = observedLength;
    const currentPage = { value: 1 };
    const deletes = diff.operations
        .filter(
            (op): op is Extract<TOperation, { kind: "delete" }> =>
                op.kind === "delete"
        )
        .sort((a, b) => b.fromIndex - a.fromIndex);
    const edits = diff.operations.filter(
        (op): op is Extract<TOperation, { kind: "edit" }> =>
            op.kind === "edit"
    );
    const moves = diff.operations
        .filter(
            (op): op is Extract<TOperation, { kind: "move" }> =>
                op.kind === "move"
        )
        .sort((a, b) => a.toIndex - b.toIndex);
    const adds = diff.operations
        .filter(
            (op): op is Extract<TOperation, { kind: "add" }> =>
                op.kind === "add"
        )
        .sort((a, b) => a.toIndex - b.toIndex);
    const ordered: TOperation[] = [...deletes, ...edits, ...moves, ...adds];

    for (const op of ordered) {
        let units = 0;
        if (op.kind === "delete") {
            const index = current.indexOf(op.entryId);
            units += visitIndexUnits(currentPage, index) + COST.menuClickWait;
            current.splice(index, 1);
        } else if (op.kind === "edit") {
            const index = current.indexOf(op.entryId);
            units += visitIndexUnits(currentPage, index);
            units += op.noteOnly
                ? noteEditUnits(op.desired.note)
                : COST.menuClickWait +
                  editUnitsForFields(
                      op as Extract<TOperation, { kind: "edit" }>
                  ) +
                  COST.goBackWait;
            if (!op.noteOnly && op.noteDiffers) {
                units += noteEditUnits(op.desired.note);
            }
        } else if (op.kind === "move") {
            let index = current.indexOf(op.entryId);
            units += moveUnits(index, op.toIndex, current.length);
            while (index !== op.toIndex) {
                units += visitIndexUnits(currentPage, index);
                const right =
                    (op.toIndex - index + current.length) % current.length;
                const left =
                    (index - op.toIndex + current.length) % current.length;
                index =
                    left <= right
                        ? (index - 1 + current.length) % current.length
                        : (index + 1) % current.length;
            }
            const entry = current.splice(current.indexOf(op.entryId), 1)[0];
            current.splice(op.toIndex, 0, entry);
        } else {
            const appendedIndex = current.length;
            units +=
                actionAddShellUnits() +
                actionWriteUnits(op.desired, op.childListDiffs);
            units += moveUnits(appendedIndex, op.toIndex, appendedIndex + 1);
            let index = appendedIndex;
            while (index !== op.toIndex) {
                units += visitIndexUnits(currentPage, index);
                const right =
                    (op.toIndex - index + appendedIndex + 1) % (appendedIndex + 1);
                const left =
                    (index - op.toIndex + appendedIndex + 1) % (appendedIndex + 1);
                index =
                    left <= right
                        ? (index - 1 + appendedIndex + 1) % (appendedIndex + 1)
                        : (index + 1) % (appendedIndex + 1);
            }
            current.push(nextEntryId++);
            const entry = current.pop() as number;
            current.splice(op.toIndex, 0, entry);
            if (op.desired.note !== undefined) {
                units += visitIndexUnits(currentPage, op.toIndex);
                units += noteEditUnits(op.desired.note);
            }
        }
        result.set(op, units);
    }
    if (ordered.length > 0) {
        const last = ordered[ordered.length - 1];
        result.set(
            last,
            (result.get(last) as number) +
                Math.abs(currentPage.value - 1) * COST.pageTurnWait
        );
    }
    return result;
}

export function actionOperationApplyUnits(
    op: ActionListOperation,
    editUnitsForFields: (op: Extract<ActionListOperation, { kind: "edit" }>) => number,
    desiredLength: number,
    plannedUnits?: ReadonlyMap<ActionListOperation, number>
): number {
    const planned = plannedUnits?.get(op);
    if (planned !== undefined) return planned;
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "move") {
        return moveUnits(op.fromIndex, op.toIndex, desiredLength);
    }
    if (op.kind === "add") {
        let total =
            actionAddShellUnits() +
            actionWriteUnits(op.desired, op.childListDiffs);
        total += moveUnits(desiredLength, op.toIndex, desiredLength + 1);
        if (op.desired.note !== undefined) total += noteEditUnits(op.desired.note);
        return total;
    }

    let total = op.noteOnly
        ? noteEditUnits(op.desired.note)
        : COST.menuClickWait + editUnitsForFields(op) + COST.goBackWait;
    if (!op.noteOnly && op.noteDiffers) {
        total += noteEditUnits(op.desired.note);
    }
    return total;
}

/**
 * Per-phase work estimate for a single action-list sync call. `readList` and
 * apply phases emit completed/total units on this shared scale.
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
    return ownSetupUnits(importable);
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
 * round trip per hydrated entry, child-list reads, and item-field captures.
 * The reader never enters an empty child list (its lore summary reads "None"),
 * so empty branches cost nothing here either.
 * A conditional parsed from .htsl may omit a branch entirely, leaving the
 * field undefined — guard every length read.
 */
function topLevelHydrateUnits(desired: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < desired.length; i++) {
        const a = desired[i];
        let lists = 0;
        for (const field of getChildListFields(a.type)) {
            const value = (a as unknown as Record<string, unknown>)[field.prop];
            if (!Array.isArray(value) || value.length === 0) continue;
            lists +=
                field.kind === "conditionList"
                    ? conditionChildListUnits(value as Condition[])
                    : knownChildListUnits(value as Action[]);
        }
        const itemFields = actionItemFieldCount(a.type);
        if (lists > 0 || itemFields > 0) {
            total +=
                COST.menuClickWait +
                COST.goBackWait +
                lists +
                itemFields * ITEM_CAPTURE_FIELD_UNITS;
        }
    }
    return total;
}

function knownChildListUnits(actions: readonly Action[] | undefined): number {
    if (actions === undefined || actions.length === 0) return 0;
    const types: Action["type"][] = [];
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
            applying: actionListDiffApplyUnits(
                diffActionList(baselineActionListFromActions([]), desired as Action[]),
                editUnitsWithChildLists,
                desired.length
            ),
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
            applying: conditionListDiffApplyUnits(
                diffConditionList(
                    baselineConditionListFromConditions([]),
                    desired as Condition[]
                )
            ),
        };
    }
    const current = baselineConditionListFromConditions(baselineCurrent);
    const diff = diffConditionList(current, desired as Condition[]);
    return {
        setup: 0,
        reading: conditionListReadUnits(baselineCurrent),
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

export function editUnitsWithChildLists(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    let total = scalarFieldEditUnitsForOp(op);

    for (let i = 0; i < op.childListDiffs.length; i++) {
        const childList = op.childListDiffs[i];
        if (childList.diff.operations.length === 0) continue;
        total += COST.menuClickWait + COST.goBackWait;
        if (childList.kind === "conditions") {
            total += conditionListDiffApplyUnits(childList.diff);
        } else {
            total += childActionListDiffApplyUnits(childList.diff);
        }
    }
    return total;
}

export function childActionListDiffApplyUnits(
    diff: ChildActionListDiff
): number {
    return actionListDiffApplyUnits(
        diff,
        childActionEditUnits,
        diff.desiredLength
    );
}

function childActionEditUnits(
    op: Extract<ChildActionListDiff["operations"][number], { kind: "edit" }>
): number {
    let total = scalarFieldEditUnitsForOp(op);
    for (const childList of op.childListDiffs) {
        if (childList.diff.operations.length === 0) continue;
        total +=
            COST.menuClickWait +
            conditionListDiffApplyUnits(childList.diff) +
            COST.goBackWait;
    }
    return total;
}

/**
 * Total work for one action-list sync (read + hydrate + apply). Wraps
 * `estimateActionListPhaseUnits`'s three parts back into a single
 * number. Used by `estimateImportableCost`.
 */
function actionListCost(
    desired: readonly Action[],
    baselineCurrent: readonly Action[] | undefined,
    trustedBaseline: boolean = false,
    basePath?: string,
    trustedChildListPaths?: ReadonlySet<string>
): number {
    if (trustedBaseline) {
        const baseline = baselineCurrent ?? [];
        if (
            basePath !== undefined &&
            trustedChildListPaths?.has(basePath) === true
        ) {
            return baselineAwareApplyUnits(desired, baseline);
        }
        return (
            pageTurnUnitsForListItemCount(baseline.length) +
            estimateTrustedActionListHydrateUnits(
                desired,
                baseline,
                basePath ?? "",
                trustedChildListPaths
            ) +
            baselineAwareApplyUnits(desired, baseline)
        );
    }
    return phaseUnitsTotal(estimateActionListPhaseUnits(desired, baselineCurrent));
}

export function estimateTrustedActionListHydrateUnits(
    desired: readonly Action[],
    baseline: readonly Action[],
    basePath: string,
    trustedChildListPaths: ReadonlySet<string> | undefined
): number {
    if (trustedChildListPaths?.has(basePath) === true) return 0;

    const matched = matchByHash(
        desired.map(actionHash),
        baseline.map(actionHash)
    );
    let total = 0;
    for (let desiredIndex = 0; desiredIndex < desired.length; desiredIndex++) {
        const baselineIndex = matched[desiredIndex];
        if (baselineIndex === null) continue;
        const action = baseline[baselineIndex];
        const desiredPath = `${basePath}[${desiredIndex}]`;
        let lists = 0;
        for (const field of getChildListFields(action.type)) {
            const value = (
                action as unknown as Record<string, unknown>
            )[field.prop];
            if (!Array.isArray(value) || value.length === 0) continue;
            if (trustedChildListPaths?.has(`${desiredPath}.${field.prop}`) === true) {
                continue;
            }
            lists +=
                field.kind === "conditionList"
                    ? conditionChildListUnits(value as Condition[])
                    : knownChildListUnits(value as Action[]);
        }
        const itemFields = actionItemFieldCount(action.type);
        if (lists > 0 || itemFields > 0) {
            total +=
                COST.menuClickWait +
                COST.goBackWait +
                lists +
                itemFields * ITEM_CAPTURE_FIELD_UNITS;
        }
    }
    return total;
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
        for (const field of getChildListFields(action.type)) {
            const value = (
                action as unknown as Record<string, unknown>
            )[field.prop];
            if (!Array.isArray(value) || value.length === 0) continue;
            lists +=
                field.kind === "conditionList"
                    ? conditionChildListUnits(value as Condition[])
                    : exactKnownChildListUnits(value as Action[]);
        }
        const itemFields = actionItemFieldCount(action.type);
        if (lists > 0 || itemFields > 0) {
            total +=
                COST.menuClickWait +
                COST.goBackWait +
                lists +
                itemFields * ITEM_CAPTURE_FIELD_UNITS;
        }
    }
    return total;
}

function exactKnownChildListUnits(actions: readonly Action[] | undefined): number {
    if (actions === undefined || actions.length === 0) return 0;
    const types: Action["type"][] = [];
    for (let i = 0; i < actions.length; i++) types.push(actions[i].type);
    return childListUnits(actions.length, types, false);
}

export function estimateImportableReadUnits(importable: Importable): number {
    if (importable.type === "FUNCTION") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            actionListReadCost(importable.actions ?? []) +
            COST.menuClickWait +
            COST.goBackWait +
            COST.cacheWrite
        );
    }
    if (importable.type === "COMMAND") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            actionListReadCost(importable.actions ?? []) +
            COST.menuClickWait +
            COST.cacheWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListReadCost(importable.actions) +
            COST.cacheWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandInterval * 4 +
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
            COST.commandInterval +
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
        let total = COST.commandInterval + COST.commandMenuWait + COST.menuClickWait;
        const slots = importable.slots;
        for (let i = 0; i < slots.length; i++) {
            total += actionListReadCost(slots[i].actions ?? []);
        }
        return total + COST.cacheWrite;
    }
    if (importable.type === "NPC") {
        return (
            COST.commandInterval +
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
    trustMode: boolean = false,
    trustedChildListPaths?: ReadonlySet<string>
): number {
    const get = (path: string): readonly Action[] | undefined =>
        getCached === undefined ? undefined : getCached(path);
    const trustedBaseline = trustMode && getCached !== undefined;

    if (importable.type === "FUNCTION") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            actionListCost(
                importable.actions ?? [],
                get("actions"),
                trustedBaseline,
                "actions",
                trustedChildListPaths
            ) +
            COST.cacheWrite
        );
    }
    if (importable.type === "COMMAND") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            actionListCost(
                importable.actions ?? [],
                get("actions"),
                trustedBaseline,
                "actions",
                trustedChildListPaths
            ) +
            commandSettingsUnits(importable) +
            COST.cacheWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandInterval +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(
                importable.actions,
                get("actions"),
                trustedBaseline,
                "actions",
                trustedChildListPaths
            ) +
            COST.cacheWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            REGION_BOUNDS_CHANGE_UNITS +
            actionListCost(
                importable.onEnterActions ?? [],
                get("onEnterActions"),
                trustedBaseline,
                "onEnterActions",
                trustedChildListPaths
            ) +
            actionListCost(
                importable.onExitActions ?? [],
                get("onExitActions"),
                trustedBaseline,
                "onExitActions",
                trustedChildListPaths
            ) +
            COST.cacheWrite
        );
    }
    if (importable.type === "ITEM") {
        const left = importable.leftClickActions ?? [];
        const right = importable.rightClickActions ?? [];
        if (left.length === 0 && right.length === 0) {
            return (
                COST.itemInject +
                COST.guaranteedSleep1000 +
                COST.cacheWrite
            );
        }
        return (
            COST.itemInject +
            COST.guaranteedSleep1000 +
            COST.commandInterval +
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListCost(
                left,
                get("leftClickActions"),
                trustedBaseline,
                "leftClickActions",
                trustedChildListPaths
            ) +
            actionListCost(
                right,
                get("rightClickActions"),
                trustedBaseline,
                "rightClickActions",
                trustedChildListPaths
            ) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.cacheWrite
        );
    }
    if (importable.type === "MENU") {
        // A menu is walked slot by slot: export and the import Reader both
        // LEFT-click into every populated slot's action editor, deep-read its
        // list, and go back (see readLiveMenu). Price that walk per slot;
        // pricing only the click (as this branch once did) undercounts a
        // menu's work by the entire cost of its action lists.
        let total = COST.commandInterval + COST.commandMenuWait + COST.menuClickWait;
        const slots = importable.slots;
        for (let i = 0; i < slots.length; i++) {
            const actions = slots[i].actions ?? [];
            total +=
                COST.commandInterval +
                COST.commandMenuWait +
                COST.menuClickWait * 2 +
                pageTurnUnitsForListItemCount(actions.length) +
                topLevelHydrateUnits(actions) +
                estimateActionListPhaseUnits(actions).applying +
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
            COST.commandInterval * 3 +
            COST.commandMenuWait * 3 +
            COST.menuClickWait * 9 +
            renameUnits +
            redirectUnits +
            actionListCost(
                left,
                get("leftClickActions"),
                trustedBaseline,
                "leftClickActions",
                trustedChildListPaths
            ) +
            actionListCost(
                right,
                get("rightClickActions"),
                trustedBaseline,
                "rightClickActions",
                trustedChildListPaths
            ) +
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
    trustMode: boolean = false,
    usesCachedInteractData: boolean = false
): number {
    if (importable.type === "ITEM" && usesCachedInteractData) {
        return COST.itemInject + COST.guaranteedSleep1000 + COST.cacheWrite;
    }
    if (cacheEntry === null) {
        return estimateImportableCost(importable);
    }
    const getCached = (basePath: string) =>
        readCachedActionList(cacheEntry.importable, basePath);
    const trustedChildListPaths = trustMode
        ? trustedChildListPathsForImportable(
              importable,
              cacheEntryListHashes(cacheEntry)
          )
        : undefined;
    let total = estimateImportableCost(
        importable,
        getCached,
        trustMode,
        trustedChildListPaths
    );
    if (
        trustMode &&
        importable.type === "COMMAND" &&
        cacheEntry.importable.type === "COMMAND"
    ) {
        total -= commandSettingsUnits(importable);
        total += commandSettingsUnits(importable, cacheEntry.importable);
    }
    if (
        trustMode &&
        importable.type === "REGION" &&
        cacheEntry.importable.type === "REGION" &&
        regionBoundsEqual(importable.bounds, cacheEntry.importable.bounds)
    ) {
        total -=
            REGION_BOUNDS_CHANGE_UNITS;
    }
    return total;
}
