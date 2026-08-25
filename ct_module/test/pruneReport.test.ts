import { describe, expect, it } from "vitest";

import {
    formatPrunePlan,
    prunePlanPopoverLines,
    summarizeTargets,
} from "../src/prune/report";
import { emptyPrunePlan, type PrunePlan, type PruneTarget } from "../src/prune/types";

function target(
    identity: string,
    overrides: Partial<PruneTarget> = {}
): PruneTarget {
    return {
        type: "FUNCTION",
        identity,
        label: identity,
        method: "delete",
        owned: true,
        ...overrides,
    };
}

function planWith(targets: PruneTarget[]): PrunePlan {
    return { ...emptyPrunePlan(), targets };
}

describe("summarizeTargets", () => {
    it("counts each type with the right plural", () => {
        expect(
            summarizeTargets([
                target("A"),
                target("B"),
                target("Shop", { type: "MENU" }),
            ])
        ).toBe("2 functions, 1 menu");
    });
});

describe("formatPrunePlan", () => {
    it("says so plainly when the house already matches the file", () => {
        const lines = formatPrunePlan(emptyPrunePlan(), "import.json");

        expect(lines.join("\n")).toContain(
            "Nothing in this house is missing from the manifest"
        );
    });

    it("separates content htsw made from content it did not", () => {
        const lines = formatPrunePlan(
            planWith([target("Mine"), target("Theirs", { owned: false })]),
            "import.json"
        ).join("\n");

        expect(lines).toContain("Imported by this project before");
        expect(lines).toContain("Not made by htsw");
        expect(lines).toContain("1 previously imported, 1 not made by htsw");
    });

    it("says the plan is incomplete when a scan failed", () => {
        const plan: PrunePlan = {
            ...planWith([target("Mine")]),
            scanFailures: [{ type: "MENU", reason: "list did not open" }],
        };

        expect(formatPrunePlan(plan, "import.json").join("\n")).toContain(
            "this plan is incomplete"
        );
    });

    it("names undeclared content it cannot remove without promising to", () => {
        const plan: PrunePlan = {
            ...emptyPrunePlan(),
            unsupported: [
                target("1,2,3", { type: "NPC", method: "report", owned: false }),
            ],
        };
        const lines = formatPrunePlan(plan, "import.json").join("\n");

        expect(lines).toContain("htsw can't remove them yet");
        expect(lines).toContain("0 to remove");
    });
});

describe("prunePlanPopoverLines", () => {
    // a sweep confirms only the owned half
    it("lists only the targets being removed, not the whole plan", () => {
        const plan = planWith([
            target("Mine"),
            target("Theirs", { owned: false }),
        ]);

        const lines = prunePlanPopoverLines([target("Mine")], plan).join("\n");

        expect(lines).toContain("Mine");
        expect(lines).not.toContain("Theirs");
        expect(lines).toContain("Imported by this project before (1)");
        expect(lines).not.toContain("Not made by htsw");
    });

    it("always ends by saying Housing has no undo", () => {
        const lines = prunePlanPopoverLines([target("Mine")], planWith([]));

        expect(lines[lines.length - 1]).toBe("Housing has no undo.");
    });

    it("still carries the plan's context lines", () => {
        const plan: PrunePlan = {
            ...planWith([target("Mine")]),
            unsupported: [
                target("1,2,3", { type: "NPC", method: "report", owned: false }),
            ],
            scanFailures: [{ type: "MENU", reason: "list did not open" }],
        };

        const lines = prunePlanPopoverLines([target("Mine")], plan).join("\n");

        expect(lines).toContain("Undeclared but not removable: 1 NPC");
        expect(lines).toContain("Scan of menus failed");
    });
});
