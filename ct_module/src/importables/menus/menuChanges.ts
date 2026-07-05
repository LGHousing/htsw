import type { Action } from "htsw/types";

/**
 * A desired or baseline menu slot reduced to the fields the change decision
 * needs: its Housing slot number, a canonical item key, and its action list.
 * Deliberately free of any Minecraft `Item` so the slot-selection rules can be
 * unit-tested without a live client — `buildMenuDiff` resolves the real item
 * payloads and layers them onto the decision this produces.
 */
export type MenuSlotSnapshot = {
    slot: number;
    itemKey: string;
    actions: Action[];
};

/** One slot the trusted import must write, and what part of it changed. */
type MenuSlotChange = {
    slot: number;
    /** Index into the desired slot list, for `slots[i].actions` paths. */
    desiredIndex: number;
    setItem: boolean;
    setActions: boolean;
};

export type MenuChangeSet = {
    /** Desired size when it differs from the baseline, else null. */
    setSize: number | null;
    changes: MenuSlotChange[];
    /** Slot numbers live in the baseline but absent from the desired menu. */
    clears: number[];
};

/**
 * Decide which menu slots a trusted import must touch, comparing the desired
 * menu against a baseline slot-for-slot by Housing slot NUMBER (not array
 * position — a menu has no inherent slot order, and a house read returns slots
 * sorted by id). A slot is left untouched only when both its item and its
 * actions match the baseline.
 */
export function planMenuChanges(
    desired: readonly MenuSlotSnapshot[],
    baseline: readonly MenuSlotSnapshot[],
    desiredSize: number | undefined,
    baselineSize: number | undefined,
    actionsDiffer: (baselineActions: Action[], desiredActions: Action[]) => boolean
): MenuChangeSet {
    const baselineBySlot = new Map<number, MenuSlotSnapshot>();
    for (const slot of baseline) baselineBySlot.set(slot.slot, slot);

    const desiredSlotIds = new Set<number>();
    const changes: MenuSlotChange[] = [];

    for (let i = 0; i < desired.length; i++) {
        const slot = desired[i];
        desiredSlotIds.add(slot.slot);
        const base = baselineBySlot.get(slot.slot);

        if (base === undefined) {
            changes.push({
                slot: slot.slot,
                desiredIndex: i,
                setItem: true,
                setActions: slot.actions.length > 0,
            });
            continue;
        }

        const itemDiffers = slot.itemKey !== base.itemKey;
        const actsDiffer = actionsDiffer(base.actions, slot.actions);
        if (!itemDiffers && !actsDiffer) continue;

        changes.push({
            slot: slot.slot,
            desiredIndex: i,
            setItem: itemDiffers,
            setActions: actsDiffer,
        });
    }

    const clears: number[] = [];
    for (const slot of baseline) {
        if (!desiredSlotIds.has(slot.slot)) clears.push(slot.slot);
    }

    const setSize =
        desiredSize !== undefined && desiredSize !== baselineSize
            ? desiredSize
            : null;
    return { setSize, changes, clears };
}
