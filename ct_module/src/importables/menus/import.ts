import type { Action, ImportableMenu } from "htsw/types";

import {
    baselineActionListFromActions,
    diffActionList,
} from "../../housingSync/actions/diff";
import { canonicalizeActionItemName } from "../../housingSync/actions/readList";
import { applyActionListPlan } from "../../housingSync/actions/apply";
import { emitApplyProgress } from "../../housingSync/actions/apply/progress";
import { prepareActionListSync } from "../../housingSync/actions/prepareSync";
import {
    COST,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../../housingSync/progress/costs";
import type { ProgressScope } from "../../housingSync/syncEvents";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { selectItemFromOpenInventory } from "../../housingSync/items/injectItem";
import { canonicalItemKey, snbtFromItem } from "../../housingSync/itemCapture";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import type { ItemRegistry } from "../itemRegistry";
import type { ImportSession } from "../imports";
import { createMissingReferencedShells } from "../references";
import { countReferencedShells } from "../referenceScanner";
import { menuCreated } from "../waiters";
import { noteMenuCreated } from "./listMenus";
import { planMenuChanges, type MenuSlotSnapshot } from "./menuChanges";
import {
    readLiveMenu,
    snapshotLiveMenuGrid,
    type LiveMenu,
    type LiveMenuGrid,
} from "./read";
import {
    openMenuEditor,
    openMenuElements,
    setMenuSize,
} from "./shared";

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
    diff: MenuDiff;
};

export async function prereadImportableMenu(
    ctx: TaskContext,
    importable: ImportableMenu,
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<MenuImportPlan> {
    const setup = createSetupStepEmitter(session.events, countReferencedShells(importable) + 1);

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const status = await openMenuEditor(ctx, importable.name);

    if (status === "missing") {
        await ctx.expectAfter(
            () => ctx.runCommand(`/menu create ${importable.name}`),
            menuCreated(importable.name)
        );
        noteMenuCreated(importable.name);
        setup(`created menu ${importable.name}`);
        // Fresh menu: every desired slot is a pure ADD, size always set.
        const ops: MenuSlotOp[] = importable.slots.map((slot, i) => {
            const item = getItemFromNbt(slot.nbt);
            const hasActions =
                slot.actions !== undefined && slot.actions.length > 0;
            return {
                slot: slot.slot,
                setItem: item,
                itemLabel: menuItemLabel(item),
                ...(hasActions
                    ? {
                          syncActions: slot.actions,
                          actionsPath: `slots[${i}].actions`,
                          actionUnits: phaseUnitsTotal(
                              estimateActionListPhaseUnits(slot.actions ?? [])
                          ),
                      }
                    : {}),
            };
        });
        return {
            kind: "MENU",
            importable,
            trustPlan,
            diff: { setSize: importable.size ?? null, ops },
        };
    }
    setup(`opened menu ${importable.name}`);

    // Trust mode reads the live grid — slot items, presence, and size, one cheap
    // container read — so those self-heal against the house, then reuses each
    // slot's cached action list rather than opening that slot's editor (the
    // expensive per-slot read). This mirrors the function trust path: observe
    // the live top level, trust the unchanged nested lists from cache. Any
    // slot whose actions actually changed still diffs non-empty and gets its
    // editor opened during apply.
    const cachedMenu =
        trustPlan?.trustMode === true && trustPlan.entry?.importable.type === "MENU"
            ? trustPlan.entry.importable
            : null;
    if (cachedMenu !== null) {
        const grid = await snapshotLiveMenuGrid(ctx);
        const diff = buildMenuDiff(
            importable,
            baselineSlotsFromGrid(grid, cachedMenu),
            grid.size,
            session.items
        );
        return { kind: "MENU", importable, trustPlan, diff };
    }

    const live = await readLiveMenu(ctx);
    const diff = buildMenuDiff(importable, baselineSlotsFromLive(live), live.size, session.items);
    return { kind: "MENU", importable, trustPlan, diff };
}

/** The live-grid slot data `buildMenuDiff` compares the desired menu against. */
type BaselineMenuSlot = { slot: number; item: Item; actions: Action[] };

function baselineSlotsFromLive(live: LiveMenu): BaselineMenuSlot[] {
    return live.slots.map((s) => ({
        slot: s.slot,
        item: getItemFromSnbt(s.snbt),
        actions: s.actions,
    }));
}

// Trusted-import baseline: slot items and presence come from the live grid
// snapshot, so they diff against the house, while each slot's actions come from
// the cached menu — the per-slot action editor is never opened here. A slot
// whose actions genuinely changed still diffs against the (stale) cached list
// and produces an op, which opens that one slot's editor during apply.
function baselineSlotsFromGrid(
    grid: LiveMenuGrid,
    cachedMenu: ImportableMenu
): BaselineMenuSlot[] {
    const cachedActionsBySlot = new Map<number, Action[]>();
    for (const slot of cachedMenu.slots) {
        cachedActionsBySlot.set(slot.slot, slot.actions ?? []);
    }
    return grid.slots.map((s) => ({
        slot: s.slot,
        item: getItemFromSnbt(s.snbt),
        actions: cachedActionsBySlot.get(s.slot) ?? [],
    }));
}

function buildMenuDiff(
    importable: ImportableMenu,
    baselineSlots: BaselineMenuSlot[],
    baselineSize: number | undefined,
    itemRegistry: ItemRegistry
): MenuDiff {
    const desiredItems = importable.slots.map((slot) => getItemFromNbt(slot.nbt));
    const desiredSnapshots: MenuSlotSnapshot[] = importable.slots.map((slot, i) => ({
        slot: slot.slot,
        itemKey: canonicalItemKey(desiredItems[i]),
        actions: slot.actions ?? [],
    }));
    const baselineSnapshots: MenuSlotSnapshot[] = baselineSlots.map((s) => ({
        slot: s.slot,
        itemKey: canonicalItemKey(s.item),
        actions: s.actions,
    }));
    const baselineBySlot = new Map<number, BaselineMenuSlot>();
    for (const s of baselineSlots) baselineBySlot.set(s.slot, s);

    const changeSet = planMenuChanges(
        desiredSnapshots,
        baselineSnapshots,
        importable.size,
        baselineSize,
        (baselineActions, desiredActions) =>
            actionsDiffer(baselineActions, desiredActions, itemRegistry)
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
                    read: snbtFromItem(baselineSlot.item, { pretty: false }) ?? "<null>",
                    desired: snbtFromItem(desiredItem, { pretty: false }) ?? "<null>",
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
    itemRegistry: ItemRegistry
): boolean {
    const liveCopy = JSON.parse(JSON.stringify(liveActions)) as Action[];
    const desiredCopy = JSON.parse(JSON.stringify(desiredActions)) as Action[];
    for (const a of liveCopy) canonicalizeActionItemName(a, itemRegistry);
    for (const a of desiredCopy) canonicalizeActionItemName(a, itemRegistry);
    return (
        diffActionList(baselineActionListFromActions(liveCopy), desiredCopy)
            .operations.length > 0
    );
}

export async function applyImportableMenuPlan(
    ctx: TaskContext,
    plan: MenuImportPlan,
    session: ImportSession
): Promise<void> {
    const { importable, trustPlan, diff } = plan;
    if (diff.setSize === null && diff.ops.length === 0) return;

    // A menu applies slot by slot, but the per-slot action-list sync reuses the
    // single-list apply machinery, which reports only that one slot's total. Own
    // the menu-wide total here and run each slot's sync as a child of it, so the
    // ETA/bar reflect every slot (a bare per-slot total collapses the menu total
    // to one slot's size after the first, pinning the bar near 100%).
    const events = session.events;
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
    await openMenuEditor(ctx, importable.name);

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
            kind: "childList",
            path: { parts: [] },
            baselineApplyUnits: completedUnits,
            parentSync: { completedUnits: workDone, totalUnits: totals.count },
        };
        const actionsSync = await prepareActionListSync(ctx, {
            desired: op.syncActions,
            session,
            trustPlan,
            basePath: op.actionsPath ?? "",
            progressScope,
            open: async () => {
                menuGridClick(op.slot, "LEFT");
                await timedWaitForMenu(ctx, "menuClickWait");
            },
        });
        if (actionsSync.kind === "planned") {
            await applyActionListPlan(ctx, actionsSync.plan, { session, progressScope });
            await clickGoBack(ctx);
        }
        finishWork(op.actionUnits ?? 0);
    }
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
