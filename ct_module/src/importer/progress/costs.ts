import type { Action, Importable } from "htsw/types";

import type {
    ActionListDiff,
    ActionListOperation,
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot,
    ScalarFieldDiff,
    UiFieldKind,
} from "../types";

export type EtaConfidence = "rough" | "informed" | "planned";

export const COST = {
    commandInterval: 1,
    commandMenuWait: 2,
    commandMessageWait: 2,

    menuClickWait: 2,
    messageClickWait: 2,
    pageTurnWait: 2,
    goBackWait: 2,

    chatInput: 3,
    anvilInput: 3,
    itemSelect: 3,

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

export function pagesForActionCount(count: number): number {
    return Math.max(1, Math.ceil(Math.max(0, count) / ACTIONS_PER_PAGE));
}

export function pageTurnBudgetForActionCount(count: number): number {
    return Math.max(0, pagesForActionCount(count) - 1) * COST.pageTurnWait;
}

export function fieldKindEditBudget(kind: UiFieldKind): number {
    if (kind === "boolean") return COST.menuClickWait;
    if (kind === "cycle") return COST.menuClickWait * 2;
    if (kind === "select") return COST.menuClickWait + COST.menuClickWait;
    if (kind === "item") return COST.itemSelect;
    if (kind === "value") return COST.chatInput;
    if (kind === "nestedList") return COST.menuClickWait;
    return COST.menuClickWait;
}

export function scalarFieldEditBudget(diffs: readonly ScalarFieldDiff[]): number {
    let total = 0;
    for (let i = 0; i < diffs.length; i++) {
        total += fieldKindEditBudget(diffs[i].kind);
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

export function actionSourceNestedBudget(action: Action): number {
    let total = 0;
    if (action.type === "CONDITIONAL") {
        total += nestedActionReadBudget(action.ifActions.length);
        total += nestedActionReadBudget(action.elseActions.length);
        total += action.conditions.length > 0 ? COST.menuClickWait + COST.goBackWait : 0;
        total += actionListSourceBudget(action.ifActions);
        total += actionListSourceBudget(action.elseActions);
    } else if (action.type === "RANDOM") {
        total += nestedActionReadBudget(action.actions.length);
        total += actionListSourceBudget(action.actions);
    }
    return total;
}

export function actionListSourceBudget(actions: readonly Action[]): number {
    let total = pageTurnBudgetForActionCount(actions.length);
    for (let i = 0; i < actions.length; i++) {
        total += actionSourceNestedBudget(actions[i]);
    }
    return total;
}

export function nestedActionReadBudget(nestedCount: number): number {
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

export function noteEditBudget(): number {
    return COST.chatInput;
}

export function actionAddShellBudget(): number {
    return COST.menuClickWait + COST.menuClickWait;
}

export function actionWriteRoughBudget(action: Action): number {
    let total = 0;
    for (const key in action) {
        if (key === "type" || key === "note") continue;
        const value = (action as { [key: string]: unknown })[key];
        if (Array.isArray(value)) continue;
        if (value === undefined) continue;
        total += COST.chatInput;
    }
    return Math.max(COST.menuClickWait, total);
}

export function actionListRoughApplyBudget(actions: readonly Action[]): number {
    let total = 0;
    for (let i = 0; i < actions.length; i++) {
        total += actionAddShellBudget() + actionWriteRoughBudget(actions[i]);
        if (actions[i].note !== undefined) total += noteEditBudget();
    }
    return total;
}

export function actionListRoughBudget(actions: readonly Action[]): number {
    return actionListSourceBudget(actions) + actionListRoughApplyBudget(actions);
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

export function estimateImportableCost(importable: Importable): number {
    if (importable.type === "FUNCTION") {
        return (
            COST.commandMenuWait +
            actionListRoughBudget(importable.actions) +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "EVENT") {
        return (
            COST.commandMenuWait +
            COST.menuClickWait +
            actionListRoughBudget(importable.actions) +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "REGION") {
        return (
            COST.commandMessageWait * 3 +
            COST.commandMenuWait +
            actionListRoughBudget(importable.onEnterActions ?? []) +
            actionListRoughBudget(importable.onExitActions ?? []) +
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
            actionListRoughBudget(left) +
            actionListRoughBudget(right) +
            COST.guaranteedSleep1000 +
            COST.nbtCapture +
            COST.knowledgeWrite
        );
    }
    if (importable.type === "MENU") {
        return COST.commandMenuWait + (importable.slots?.length ?? 0) * COST.menuClickWait + COST.knowledgeWrite;
    }
    return COST.commandMenuWait + COST.knowledgeWrite;
}
