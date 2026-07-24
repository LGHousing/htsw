import type { Action, ImportableMenu } from "htsw/types";

import {
    baselineActionListFromActions,
    diffActionList,
} from "../../housingSync/actions/diff";
import { canonicalizeActionItemName } from "../../housingSync/actions/readList";
import { applyActionListPlan } from "../../housingSync/actions/apply";
import type { ActionListPlan } from "../../housingSync/actions/plan";
import { fullyHydratedActionsFromSlots } from "../../housingSync/actions/hydration/plan";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { emitApplyProgress } from "../../housingSync/actions/apply/progress";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
} from "../../housingSync/actions/prepareSync";
import {
    COST,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../../housingSync/progress/costs";
import type { ProgressScope } from "../../housingSync/syncEvents";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { selectItemFromOpenInventory } from "../../housingSync/items/itemPicker";
import { canonicalItemShellKey, snbtFromItem } from "../../housingSync/items/itemNbt";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import { createProgressGroup } from "../../housingSync/progress/group";
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import type { ProjectItemIndex } from "../items/projectItems";
import type { ImportContext } from "../import/context";
import type { ItemDiffContext } from "../../housingSync/actions/diff/itemDiffContext";
import { importableIdentity } from "../identity";
import { menuCreated } from "../waiters";
import { noteMenuCreated } from "./listMenus";
import { planMenuChanges, type MenuSlotSnapshot } from "./menuChanges";
import { snapshotLiveMenuGrid, type LiveMenuGrid } from "./read";
import { openMenuEditor, openMenuElements, setMenuSize } from "./housing";

/**
 * One grid slot's work. A slot needs at most one op, which may both set the
 * item and sync its actions (e.g. a fresh ADD). `clear` is the stale-slot
 * removal (a slot live in-game but absent from the import).
 */
type MenuSlotOp = {
    slot: number;
    setItem?: Item;
    syncActions?: Action[];
    /** Trust/baseline path for `syncActions` (e.g. `slots[3].actions`). */
    actionsPath?: string;
    clear?: boolean;
    /** Diagnostic only: read-back vs desired item SNBT when the item differs,
     * so a residual can show exactly what changed instead of just "item differs". */
    itemCompare?: { read: string; desired: string };
    /** Desired item's display name, for the live slot label; null when unknown. */
    itemLabel?: string | null;
    /** Estimated units for this slot's action-list sync — its child-list budget
     * against the menu-wide apply total. */
    actionUnits?: number;
    actionsPlan?: ActionListPlan;
};

// Writing one slot's item: RIGHT-click opens the picker, then one pick.
const ITEM_WRITE_UNITS = COST.menuClickWait + COST.itemSelect;
// Emptying one slot: RIGHT-click opens the picker, then click "Clear Item".
const SLOT_CLEAR_UNITS = COST.menuClickWait * 2;

function menuItemLabel(item: Item | null | undefined): string | null {
    if (item === null || item === undefined) return null;
    try {
        const name = removedFormatting(item.getName());
        return name.length > 0 ? name : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Work-item count + total apply units for a menu diff's ops, summed in the
 * order the apply pass visits them (clears, then item writes, then action
 * syncs). Drives the menu-wide apply total so the ETA reflects every slot
 * rather than collapsing to whichever slot's action list is open.
 */
export function menuApplyTotals(
    ops: ReadonlyArray<{
        clear?: boolean;
        setItem?: unknown;
        syncActions?: unknown;
        actionUnits?: number;
    }>
): { count: number; units: number } {
    let count = 0;
    let units = 0;
    for (const op of ops) {
        if (op.clear === true) {
            count++;
            units += SLOT_CLEAR_UNITS;
            continue;
        }
        if (op.setItem !== undefined) {
            count++;
            units += ITEM_WRITE_UNITS;
        }
        if (op.syncActions !== undefined) {
            count++;
            units += op.actionUnits ?? 0;
        }
    }
    return { count, units };
}

type MenuDiff = {
    /** Desired size when it differs from the live menu, else null. */
    setSize: number | null;
    ops: MenuSlotOp[];
};

export type MenuImportPlan = {
    kind: "MENU";
    importable: ImportableMenu;
    trustPlan?: ImportableTrustPlan;
    exists: boolean;
    diff: MenuDiff;
};

type MenuSlotRead = {
    desiredIndex: number;
    slot: number;
    label: string | null;
    actions: ActionListSyncScanResult;
};

export type MenuRead = {
    kind: "MENU";
    importable: ImportableMenu;
    trustPlan?: ImportableTrustPlan;
    grid: LiveMenuGrid | null;
    slots: MenuSlotRead[];
    events?: SyncEventHandler;
};

export async function scanImportableMenu(
    ctx: TaskContext,
    importable: ImportableMenu,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<MenuRead> {
    const setup = createSetupStepEmitter(session.actions.events, 1);
    const status = await openMenuEditor(ctx, importable.name);
    const grid = status === "missing" ? null : await snapshotLiveMenuGrid(ctx);
    const populated = new Set(grid?.slots.map((slot) => slot.slot) ?? []);
    const slots: MenuSlotRead[] = [];
    const progress = createProgressGroup(session.actions.events, importable.slots.length);
    for (let i = 0; i < importable.slots.length; i++) {
        const desired = importable.slots[i];
        const label = menuItemLabel(getItemFromNbt(desired.nbt));
        session.actions.events?.emit({
            kind: "menuSlotStarted",
            slot: desired.slot,
            label,
            index: i + 1,
            count: importable.slots.length,
        });
        const basePath = `slots[${i}].actions`;
        const actions = await scanActionListSync(ctx, {
            desired: desired.actions ?? [],
            sync: session.actions,
            trustPlan: grid === null ? undefined : trustPlan,
            basePath,
            current: populated.has(desired.slot) ? undefined : { kind: "known-empty" },
            conflictTarget: {
                type: importable.type,
                identity: importableIdentity(importable),
                basePath,
            },
            open: () => openMenuSlotActions(ctx, importable.name, desired.slot),
            progress: progress.part(i),
        });
        slots.push({ desiredIndex: i, slot: desired.slot, label, actions });
    }
    setup(
        grid === null
            ? `menu ${importable.name} is missing`
            : `scanned menu ${importable.name}`
    );
    return {
        kind: "MENU",
        importable,
        trustPlan,
        grid,
        slots,
        events: session.actions.events,
    };
}

async function openMenuSlotActions(
    ctx: TaskContext,
    name: string,
    slot: number
): Promise<void> {
    if ((await openMenuEditor(ctx, name)) === "missing") {
        throw new Error(`Menu ${name} disappeared during read.`);
    }
    await openMenuElements(ctx);
    menuGridClick(slot, "LEFT");
    await timedWaitForMenu(ctx, "menuClickWait");
}

export async function hydrateImportableMenu(
    ctx: TaskContext,
    read: MenuRead
): Promise<void> {
    for (const slot of read.slots) {
        if (slot.actions.kind === "hydrate") {
            read.events?.emit({
                kind: "menuSlotStarted",
                slot: slot.slot,
                label: slot.label,
                index: slot.desiredIndex + 1,
                count: read.slots.length,
            });
            slot.actions = await hydrateActionListSync(ctx, slot.actions);
        }
    }
}

/** The live-grid slot data `buildMenuDiff` compares the desired menu against. */
type BaselineMenuSlot = {
    slot: number;
    item: Item;
    actions: Action[];
    actionsKnown: boolean;
};

export function menuActionBaseline(
    actionPlan: ActionListPlan | null,
    cached: Action[] | undefined,
    menuName: string,
    path: string,
    slot: number,
    declared: boolean
): { actions: Action[]; actionsKnown: boolean } {
    if (actionPlan === null) {
        if (cached !== undefined) {
            return { actions: cached, actionsKnown: true };
        }
        // A live slot the project doesn't declare is only ever cleared, so an
        // empty baseline is fine; a declared slot with neither a plan nor a
        // cached list has nothing sound to diff against.
        if (!declared) {
            return { actions: [], actionsKnown: true };
        }
        throw new Error(
            `Menu "${menuName}" has no usable baseline for ${path} ` +
                `(Housing slot ${slot}; unhydrated action indexes/types: ` +
                "unavailable because no action plan exists)."
        );
    }
    const hydrated = fullyHydratedActionsFromSlots(actionPlan.observed);
    if (hydrated !== null) {
        return { actions: hydrated, actionsKnown: true };
    }
    return {
        actions: observedSlotsToActions(actionPlan.observed),
        actionsKnown: false,
    };
}

export function planImportableMenu(
    read: MenuRead,
    session: ImportContext
): MenuImportPlan {
    const cachedMenu =
        read.trustPlan?.entry?.importable.type === "MENU"
            ? read.trustPlan.entry.importable
            : null;
    const cachedBySlot = new Map<number, Action[]>();
    for (const slot of cachedMenu?.slots ?? []) {
        cachedBySlot.set(slot.slot, slot.actions ?? []);
    }
    const actionReadBySlot = new Map(read.slots.map((slot) => [slot.slot, slot]));
    const baseline: BaselineMenuSlot[] = (read.grid?.slots ?? []).map((slot) => {
        const actionRead = actionReadBySlot.get(slot.slot)?.actions;
        const actionPlan =
            actionRead === undefined ? null : actionListPlanFromRead(actionRead);
        const cached = cachedBySlot.get(slot.slot);
        const desiredIndex = actionReadBySlot.get(slot.slot)?.desiredIndex;
        const path =
            desiredIndex === undefined
                ? "slots[unknown].actions"
                : `slots[${desiredIndex}].actions`;
        const actionBaseline = menuActionBaseline(
            actionPlan,
            cached,
            read.importable.name,
            path,
            slot.slot,
            desiredIndex !== undefined
        );
        return {
            slot: slot.slot,
            item: getItemFromSnbt(slot.snbt),
            actions: actionBaseline.actions,
            actionsKnown: actionBaseline.actionsKnown,
        };
    });
    const diff = buildMenuDiff(
        read.importable,
        baseline,
        read.grid?.size,
        session.items,
        session.actions.itemDiff
    );
    const readsByPath = new Map(
        read.slots.map((slot) => [`slots[${slot.desiredIndex}].actions`, slot])
    );
    for (const op of diff.ops) {
        const actionRead =
            op.actionsPath === undefined ? undefined : readsByPath.get(op.actionsPath);
        if (actionRead !== undefined) {
            const actionPlan = actionListPlanFromRead(actionRead.actions);
            if (actionPlan !== null) {
                op.actionsPlan = actionPlan;
                op.actionUnits = actionPlan.phaseUnits.applying;
            }
        }
    }
    return {
        kind: "MENU",
        importable: read.importable,
        trustPlan: read.trustPlan,
        exists: read.grid !== null,
        diff,
    };
}

function buildMenuDiff(
    importable: ImportableMenu,
    baselineSlots: BaselineMenuSlot[],
    baselineSize: number | undefined,
    projectItems: ProjectItemIndex,
    itemDiff?: ItemDiffContext
): MenuDiff {
    const desiredItems = importable.slots.map((slot) => getItemFromNbt(slot.nbt));
    const desiredSnapshots: MenuSlotSnapshot[] = importable.slots.map((slot, i) => ({
        slot: slot.slot,
        itemKey: canonicalItemShellKey(desiredItems[i]),
        actions: slot.actions ?? [],
    }));
    const baselineSnapshots: MenuSlotSnapshot[] = baselineSlots.map((s) => ({
        slot: s.slot,
        itemKey: canonicalItemShellKey(s.item),
        actions: s.actions,
        actionsKnown: s.actionsKnown,
    }));
    const baselineBySlot = new Map<number, BaselineMenuSlot>();
    for (const s of baselineSlots) baselineBySlot.set(s.slot, s);

    const changeSet = planMenuChanges(
        desiredSnapshots,
        baselineSnapshots,
        importable.size,
        baselineSize,
        (baselineActions, desiredActions) =>
            actionsDiffer(baselineActions, desiredActions, projectItems, itemDiff)
    );

    const ops: MenuSlotOp[] = [];
    for (const change of changeSet.changes) {
        const slot = importable.slots[change.desiredIndex];
        const op: MenuSlotOp = { slot: change.slot };
        op.itemLabel = menuItemLabel(desiredItems[change.desiredIndex]);
        if (change.setItem) {
            const desiredItem = desiredItems[change.desiredIndex];
            op.setItem = desiredItem;
            const baselineSlot = baselineBySlot.get(change.slot);
            if (baselineSlot !== undefined) {
                op.itemCompare = {
                    read: snbtFromItem(baselineSlot.item, { pretty: false }),
                    desired: snbtFromItem(desiredItem, { pretty: false }),
                };
            }
        }
        if (change.setActions) {
            op.syncActions = slot.actions ?? [];
            op.actionsPath = `slots[${change.desiredIndex}].actions`;
            op.actionUnits = phaseUnitsTotal(
                estimateActionListPhaseUnits(
                    op.syncActions,
                    baselineBySlot.get(change.slot)?.actions
                )
            );
        }
        ops.push(op);
    }
    for (const slot of changeSet.clears) ops.push({ slot, clear: true });

    return { setSize: changeSet.setSize, ops };
}

/**
 * Whether a slot's live action list differs from the desired one. Canonicalises
 * item-bearing fields first (as the action-list sync does) so they compare by
 * canonical name, then reuses the action diff: any operation means they differ.
 */
function actionsDiffer(
    liveActions: Action[],
    desiredActions: Action[],
    projectItems: ProjectItemIndex,
    itemDiff?: ItemDiffContext
): boolean {
    if (itemDiff?.hasActionList(desiredActions) === true) return true;
    if (itemDiff !== undefined) {
        const length = Math.min(liveActions.length, desiredActions.length);
        for (let i = 0; i < length; i++) {
            if (itemDiff.actionsDiffer(liveActions[i], desiredActions[i])) {
                return true;
            }
        }
    }
    const liveCopy = JSON.parse(JSON.stringify(liveActions)) as Action[];
    const desiredCopy = JSON.parse(JSON.stringify(desiredActions)) as Action[];
    const canonicalizeItemName = (name: string): string =>
        projectItems.canonicalizeObservedName(name);
    for (const a of liveCopy) canonicalizeActionItemName(a, canonicalizeItemName);
    for (const a of desiredCopy) canonicalizeActionItemName(a, canonicalizeItemName);
    return (
        diffActionList(baselineActionListFromActions(liveCopy), desiredCopy).operations
            .length > 0
    );
}

export async function applyImportableMenuPlan(
    ctx: TaskContext,
    plan: MenuImportPlan,
    session: ImportContext
): Promise<void> {
    const { importable, diff } = plan;
    if (plan.exists && diff.setSize === null && diff.ops.length === 0) return;

    // A menu applies slot by slot, but the per-slot action-list sync reuses the
    // single-list apply machinery, which reports only that one slot's total. Own
    // the menu-wide total here and run each slot's sync as a child of it, so the
    // ETA/bar reflect every slot (a bare per-slot total collapses the menu total
    // to one slot's size after the first, pinning the bar near 100%).
    const events = session.actions.events;
    const totals = menuApplyTotals(diff.ops);
    const applyingUnits = Math.max(1, totals.units);
    let completedUnits = 0;
    let workDone = 0;

    const emitMenuTotal = (): void => {
        emitApplyProgress(
            events,
            { kind: "topLevel" },
            { setup: 0, reading: 0, hydrating: 0, applying: applyingUnits },
            completedUnits,
            workDone,
            totals.count
        );
    };
    const startSlot = (slot: number, label: string | null | undefined): void => {
        events?.emit({
            kind: "menuSlotStarted",
            slot,
            label: label ?? null,
            index: Math.min(totals.count, workDone + 1),
            count: totals.count,
        });
    };
    const finishWork = (units: number): void => {
        completedUnits += units;
        workDone++;
        emitMenuTotal();
    };

    emitMenuTotal();
    const exists =
        plan.exists ||
        session.ensuredReferencedShells.menus.has(importable.name.toLowerCase());
    if (!exists) {
        await ctx.expectAfter(
            () => ctx.runCommand(`/menu create ${importable.name}`),
            menuCreated(importable.name)
        );
        noteMenuCreated(importable.name);
    } else {
        await openMenuEditor(ctx, importable.name);
    }

    let remainingOps = diff.ops;
    const clearOps = diff.ops.filter((op) => op.clear === true);
    if (diff.setSize !== null && clearOps.length > 0) {
        await openMenuElements(ctx);
        for (const op of clearOps) {
            startSlot(op.slot, null);
            await clearMenuSlot(ctx, op.slot);
            finishWork(SLOT_CLEAR_UNITS);
        }
        await clickGoBack(ctx);
        remainingOps = diff.ops.filter((op) => op.clear !== true);
    }
    if (diff.setSize !== null) await setMenuSize(ctx, diff.setSize);
    if (remainingOps.length === 0) return;
    await openMenuElements(ctx);

    // Items first, then actions. RIGHT-click opens the "Select an Item" picker
    // for empty and populated slots alike (its "Clear Item" button lives there
    // too); setting the item leaves the slot populated, so the second pass can
    // LEFT-click straight into each slot's action list.
    for (const op of remainingOps) {
        if (op.clear) {
            startSlot(op.slot, null);
            await clearMenuSlot(ctx, op.slot);
            finishWork(SLOT_CLEAR_UNITS);
        } else if (op.setItem !== undefined) {
            startSlot(op.slot, op.itemLabel);
            menuGridClick(op.slot, "RIGHT");
            await timedWaitForMenu(ctx, "menuClickWait");
            await selectItemFromOpenInventory(ctx, op.setItem, `menu slot ${op.slot}`);
            finishWork(ITEM_WRITE_UNITS);
        }
    }

    for (const op of remainingOps) {
        if (op.syncActions === undefined) continue;
        startSlot(op.slot, op.itemLabel);
        const progressScope: ProgressScope = {
            kind: "menuSlotActions",
            baselineApplyUnits: completedUnits,
            parentSync: { completedUnits: workDone, totalUnits: totals.count },
        };
        const openActionsEditor = async (): Promise<void> => {
            menuGridClick(op.slot, "LEFT");
            await timedWaitForMenu(ctx, "menuClickWait");
        };
        if (op.actionsPlan !== undefined) {
            await openActionsEditor();
            await applyActionListPlan(ctx, op.actionsPlan, {
                sync: session.actions,
                progressScope,
            });
            await clickGoBack(ctx);
        }
        finishWork(op.actionUnits ?? 0);
    }
}

export function menuPlanIsNoOp(plan: MenuImportPlan): boolean {
    return plan.exists && plan.diff.setSize === null && plan.diff.ops.length === 0;
}

function menuGridClick(slot: number, button: "LEFT" | "RIGHT"): void {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error("No open container while editing menu slot " + slot);
    }
    container.click(slot, false, button);
}

/**
 * Empty a populated menu grid slot — the stale-slot removal op. RIGHT-click
 * opens the "Select an Item" picker; its "Clear Item" button unsets the slot.
 *
 * Only the item is cleared. A slot with actions but no item is invalid, and
 * Housing drops those orphaned actions when the menu is closed — so there's
 * nothing to clear separately here.
 */
async function clearMenuSlot(ctx: TaskContext, slotId: number): Promise<void> {
    menuGridClick(slotId, "RIGHT");
    await timedWaitForMenu(ctx, "menuClickWait");

    const clearButton = ctx.getItemSlot(
        (s) => removedFormatting(s.getItem().getName()).indexOf("Clear Item") >= 0
    );
    clearButton.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}
