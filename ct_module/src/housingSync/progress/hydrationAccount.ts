import type {
    ActionHydrationWork,
    ChildListName,
    ObservedActionSlot,
} from "../types";
import type { ProgressPayload } from "./types";
import { childListReadUnits, COST, ITEM_CAPTURE_FIELD_UNITS } from "./costs";

/**
 * Live cost accounting for one hydration entry (one action being deep-read).
 *
 * The entry starts booked at the same upfront estimate
 * `hydrationEntryUnits` charges: an editor round trip, `childListReadUnits`
 * per child list, and the item captures. As each child list's read actually
 * runs, its progress payloads replace that list's estimate with the total
 * the read itself has established — pages it has turned plus the hydration
 * plan it builds from what it observed (truncated scalars, condition
 * scalar hydrates). The estimate is a floor, never a ceiling: booked units
 * only move above it when the child read proves more work exists, so the
 * totals a caller derives from this account never dip mid-entry.
 *
 * Completed units credit as child payloads arrive instead of in one lump
 * when the whole entry finishes; the entry's own go-back and item captures
 * are credited by `finish()`.
 */
export type HydrationEntryAccount = {
    onChildPayload(prop: ChildListName, payload: ProgressPayload): void;
    /** Currently booked units for the whole entry (starts at the estimate). */
    bookedUnits(): number;
    /** Units credited as completed so far within this entry. */
    completedUnits(): number;
    /** Close the entry: credit everything and return the final booked units. */
    finish(): number;
};

/**
 * The parent pays for clicking a child-list field open and going back —
 * the child read's own units never include that surround.
 */
const CHILD_LIST_SURCHARGE = COST.menuClickWait + COST.goBackWait;

export function createHydrationEntryAccount(
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    onChange: () => void,
    includeSpeculativeChildRowScalarHydrate: boolean = true
): HydrationEntryAccount {
    // Unparsed entries are skipped by the hydrator and priced at zero by
    // `hydrationEntryUnits`; the account must agree or the entry would
    // book a phantom round trip.
    if (entry.action === null) {
        return {
            onChildPayload() {},
            bookedUnits: () => 0,
            completedUnits: () => 0,
            finish: () => 0,
        };
    }
    const editorRoundTrip = COST.menuClickWait + COST.goBackWait;
    const captureUnits = work.itemFieldsToCapture.length * ITEM_CAPTURE_FIELD_UNITS;

    const booked = new Map<ChildListName, number>();
    const completed = new Map<ChildListName, number>();
    work.childListsToRead.forEach((prop) => {
        booked.set(
            prop,
            childListReadUnits(
                entry,
                prop,
                includeSpeculativeChildRowScalarHydrate
            )
        );
    });
    let activeProp: ChildListName | null = null;
    let finished = false;

    const settleActiveProp = (): void => {
        if (activeProp === null) return;
        completed.set(activeProp, booked.get(activeProp) ?? 0);
        activeProp = null;
    };

    const bookedUnits = (): number => {
        let total = editorRoundTrip + captureUnits;
        booked.forEach((units) => {
            total += units;
        });
        return total;
    };

    return {
        onChildPayload(prop, payload) {
            if (finished) return;
            if (activeProp !== prop) settleActiveProp();
            activeProp = prop;
            const floor = booked.get(prop) ?? 0;
            const observed = CHILD_LIST_SURCHARGE + Math.max(0, payload.totalUnits);
            const nowBooked = Math.max(floor, observed);
            booked.set(prop, nowBooked);
            completed.set(
                prop,
                Math.min(
                    nowBooked,
                    COST.menuClickWait + Math.max(0, payload.completedUnits)
                )
            );
            onChange();
        },
        bookedUnits,
        completedUnits() {
            let total = COST.menuClickWait;
            completed.forEach((units) => {
                total += units;
            });
            return Math.min(total, bookedUnits());
        },
        finish() {
            finished = true;
            settleActiveProp();
            return bookedUnits();
        },
    };
}
