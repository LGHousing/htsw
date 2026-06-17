import type { Action, ImportableMenu } from "htsw/types";

import {
    baselineActionListFromActions,
    diffActionList,
} from "../../housingSync/actions/diff";
import { canonicalizeActionItemName } from "../../housingSync/actions/readList";
import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import { prereadActionList } from "../../housingSync/actions/plan";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import {
    timedWaitForMenu,
    timedWaitForUnformattedMessage,
} from "../../housingSync/gui/menuWait";
import {
    selectItemFromOpenInventory,
    stacksEqual,
} from "../../housingSync/items/injectItem";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { getItemFromNbt, getItemFromSnbt } from "../../utils/nbt";
import {
    getActionListTrust,
    getBaselineActionList,
} from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import type { ImportSession } from "../imports";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { readLiveMenu, type LiveMenu } from "./read";
import { openMenuEditor, openMenuElements, setMenuSize } from "./shared";

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
};

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

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const status = await openMenuEditor(ctx, importable.name);

    if (status === "missing") {
        await ctx.runCommand(`/menu create ${importable.name}`);
        await timedWaitForUnformattedMessage(
            ctx,
            `Created custom menu with the title ${importable.name}!`
        );
        await openMenuEditor(ctx, importable.name);
        setup(`created menu ${importable.name}`);
        // Fresh menu: every desired slot is a pure ADD, size always set.
        const ops: MenuSlotOp[] = importable.slots.map((slot, i) => ({
            slot: slot.slot,
            setItem: getItemFromNbt(slot.nbt),
            ...(slot.actions !== undefined && slot.actions.length > 0
                ? { syncActions: slot.actions, actionsPath: `slots[${i}].actions` }
                : {}),
        }));
        return {
            kind: "MENU",
            importable,
            trustPlan,
            diff: { setSize: importable.size ?? null, ops },
        };
    }
    setup(`opened menu ${importable.name}`);

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

function buildMenuDiff(
    importable: ImportableMenu,
    baselineSlots: BaselineMenuSlot[],
    baselineSize: number | undefined,
    itemRegistry: ItemRegistry
): MenuDiff {
    const baselineBySlot = new Map<number, BaselineMenuSlot>();
    for (const s of baselineSlots) baselineBySlot.set(s.slot, s);

    const desiredSlotIds = new Set<number>();
    const ops: MenuSlotOp[] = [];

    for (let i = 0; i < importable.slots.length; i++) {
        const slot = importable.slots[i];
        desiredSlotIds.add(slot.slot);
        const desiredItem = getItemFromNbt(slot.nbt);
        const desiredActions = slot.actions ?? [];
        const actionsPath = `slots[${i}].actions`;
        const baselineSlot = baselineBySlot.get(slot.slot);

        if (baselineSlot === undefined) {
            ops.push({
                slot: slot.slot,
                setItem: desiredItem,
                ...(desiredActions.length > 0
                    ? { syncActions: desiredActions, actionsPath }
                    : {}),
            });
            continue;
        }

        const itemDiffers = !stacksEqual(
            desiredItem.getItemStack(),
            baselineSlot.item.getItemStack()
        );
        const actsDiffer = actionsDiffer(baselineSlot.actions, desiredActions, itemRegistry);
        if (!itemDiffers && !actsDiffer) continue;

        ops.push({
            slot: slot.slot,
            ...(itemDiffers ? { setItem: desiredItem } : {}),
            ...(actsDiffer ? { syncActions: desiredActions, actionsPath } : {}),
        });
    }

    for (const s of baselineSlots) {
        if (!desiredSlotIds.has(s.slot)) ops.push({ slot: s.slot, clear: true });
    }

    const setSize =
        importable.size !== undefined && importable.size !== baselineSize
            ? importable.size
            : null;
    return { setSize, ops };
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

    await openMenuEditor(ctx, importable.name);

    let remainingOps = diff.ops;
    const clearOps = diff.ops.filter((op) => op.clear === true);
    if (diff.setSize !== null && clearOps.length > 0) {
        await openMenuElements(ctx);
        for (const op of clearOps) await clearMenuSlot(ctx, op.slot);
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
            await clearMenuSlot(ctx, op.slot);
        } else if (op.setItem !== undefined) {
            menuGridClick(op.slot, "RIGHT");
            await timedWaitForMenu(ctx, "menuClickWait");
            await selectItemFromOpenInventory(ctx, op.setItem, `menu slot ${op.slot}`);
        }
    }

    for (const op of remainingOps) {
        if (op.syncActions === undefined) continue;
        menuGridClick(op.slot, "LEFT");
        await timedWaitForMenu(ctx, "menuClickWait");
        ctx.getItemSlot("Edit Actions").click();
        await timedWaitForMenu(ctx, "menuClickWait");
        const actionsPlan = await prereadActionList(ctx, op.syncActions, {
            session,
            baselineCurrent: getBaselineActionList(trustPlan, op.actionsPath ?? ""),
            trust: getActionListTrust(trustPlan, op.actionsPath ?? ""),
        });
        await applyActionListPlan(ctx, actionsPlan, { session });
        await clickGoBack(ctx);
        await clickGoBack(ctx);
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
