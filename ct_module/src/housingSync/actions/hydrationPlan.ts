import type {
    ActionHydrationPlan,
    ActionHydrationWork,
    ActionItemFieldToCapture,
    ActionScalarFieldToRead,
    ChildListsToRead,
    ObservedActionSlot,
} from "../types";

export function createActionHydrationWork(
    childListsToRead: ChildListsToRead = new Set()
): ActionHydrationWork {
    return {
        childListsToRead,
        scalarFieldsToRead: [],
        itemFieldsToCapture: [],
    };
}

function ensureActionHydrationWork(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot
): ActionHydrationWork {
    let work = plan.get(entry);
    if (work === undefined) {
        work = createActionHydrationWork();
        plan.set(entry, work);
    }
    return work;
}

export function actionHydrationWorkRequiresHousing(
    work: ActionHydrationWork
): boolean {
    return (
        work.childListsToRead.size > 0 ||
        work.scalarFieldsToRead.length > 0 ||
        work.itemFieldsToCapture.length > 0
    );
}

export function addScalarFieldsToRead(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot,
    fields: ActionScalarFieldToRead[]
): void {
    if (fields.length === 0) return;
    const work = ensureActionHydrationWork(plan, entry);
    work.scalarFieldsToRead = fields;
}

export function addItemFieldsToCapture(
    plan: ActionHydrationPlan,
    entry: ObservedActionSlot,
    fields: ActionItemFieldToCapture[]
): void {
    if (fields.length === 0) return;
    const work = ensureActionHydrationWork(plan, entry);
    work.itemFieldsToCapture = fields;
}
