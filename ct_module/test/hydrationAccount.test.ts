import { describe, expect, test } from "vitest";

import { COST, hydrationEntryUnits } from "../src/housingSync/progress/costs";
import { createHydrationEntryAccount } from "../src/housingSync/progress/hydrationAccount";
import type { ProgressPayload } from "../src/housingSync/progress/types";
import type { ActionHydrationWork } from "../src/housingSync/actions/hydration/plan";
import type {
    ChildListsToRead,
    ObservedActionSlot,
} from "../src/housingSync/observedActions";

import { conditional, message, observedSlot } from "./utils";

function workFor(childLists: ChildListsToRead): ActionHydrationWork {
    return {
        childListsToRead: childLists,
        scalarFieldsToRead: [],
        itemFieldsToCapture: [],
    };
}

function payload(
    completedUnits: number,
    totalUnits: number,
    phase: ProgressPayload["phase"] = "reading"
): ProgressPayload {
    return {
        phase,
        completedUnits,
        totalUnits,
        phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
        sync: { completedUnits: 0, totalUnits: 1, parent: null },
    };
}

function conditionalEntry(): ObservedActionSlot {
    const entry = observedSlot(
        0,
        conditional({ ifActions: [message("a"), message("b")] })
    );
    entry.childListSummaries = { ifActions: ["MESSAGE", "MESSAGE"] };
    entry.childListsToRead = new Set(["ifActions"]);
    return entry;
}

describe("hydration entry account", () => {
    test("starts booked at exactly the upfront estimate", () => {
        const entry = conditionalEntry();
        const work = workFor(new Set(["ifActions"]));
        const account = createHydrationEntryAccount(entry, work, () => {});

        expect(account.bookedUnits()).toBeCloseTo(hydrationEntryUnits(entry, work));
    });

    test("child payloads only raise booked units above the estimate floor", () => {
        const entry = conditionalEntry();
        const work = workFor(new Set(["ifActions"]));
        let changes = 0;
        const account = createHydrationEntryAccount(entry, work, () => changes++);
        const estimate = account.bookedUnits();

        // A tiny early payload (child read just started) must not shrink the booking.
        account.onChildPayload("ifActions", payload(0, 0));
        expect(account.bookedUnits()).toBeCloseTo(estimate);

        // The child read establishing MORE work than estimated raises it.
        account.onChildPayload("ifActions", payload(3, estimate + 20, "hydrating"));
        expect(account.bookedUnits()).toBeGreaterThan(estimate);
        expect(changes).toBe(2);
    });

    test("completed units credit incrementally and settle to booked on finish", () => {
        const entry = conditionalEntry();
        const work = workFor(new Set(["ifActions"]));
        const account = createHydrationEntryAccount(entry, work, () => {});

        expect(account.completedUnits()).toBeLessThanOrEqual(COST.menuClickWait);
        account.onChildPayload("ifActions", payload(4, 10, "hydrating"));
        const mid = account.completedUnits();
        expect(mid).toBeGreaterThan(0);
        account.onChildPayload("ifActions", payload(8, 10, "hydrating"));
        expect(account.completedUnits()).toBeGreaterThan(mid);
        expect(account.completedUnits()).toBeLessThanOrEqual(account.bookedUnits());

        const final = account.finish();
        expect(final).toBe(account.bookedUnits());
    });

    test("null-action entries book zero, matching hydrationEntryUnits", () => {
        const entry: ObservedActionSlot = {
            index: 0,
            slotId: 0,
            slot: null as never,
            action: null,
            hydrated: false,
            truncatedFields: [],
            childListSummaries: {},
            childListsToRead: new Set(),
        };
        const work = workFor(new Set());
        const account = createHydrationEntryAccount(entry, work, () => {});
        expect(account.bookedUnits()).toBe(0);
        expect(account.finish()).toBe(hydrationEntryUnits(entry, work));
    });
});
