import { describe, expect, it } from "vitest";

import {
    buildHouseQueueMenu,
    declaredOverwriteNames,
    queueNamesForRow,
} from "../src/gui/left-panel/houses/queueMenu";
import { buildOverwriteConfirmation } from "../src/gui/left-panel/houses/overwriteConfirmation";

describe("Houses queue menu", () => {
    it("uses the exact counts and disables only empty actions", () => {
        expect(
            buildHouseQueueMenu(
                "Functions",
                { all: 27, changed: 3, unread: 5, shown: 12, new: 0 },
                true
            )
        ).toEqual([
            {
                kind: "action",
                id: "read-all",
                label: "Read all functions (27)",
                disabled: false,
            },
            {
                kind: "action",
                id: "read-unread",
                label: "Read unread (5)",
                disabled: false,
            },
            {
                kind: "action",
                id: "read-shown",
                label: "Read shown (12)",
                disabled: false,
            },
            { kind: "separator" },
            {
                kind: "action",
                id: "export-all",
                label: "Export all functions (27)",
                disabled: false,
            },
            {
                kind: "action",
                id: "export-new",
                label: "Export new (0)",
                disabled: true,
            },
            {
                kind: "action",
                id: "export-changed",
                label: "Export changed (3)",
                disabled: false,
            },
            {
                kind: "action",
                id: "export-shown",
                label: "Export shown (12)",
                disabled: false,
            },
            { kind: "separator" },
            {
                kind: "action",
                id: "export-house",
                label: "Export whole house",
                disabled: false,
            },
        ]);
    });

    it("keeps the all actions enabled with ? before the first scan", () => {
        const entries = buildHouseQueueMenu(
            "Functions",
            { all: null, changed: 0, unread: 0, shown: 0, new: 0 },
            true
        );
        const byId = new Map(
            entries
                .filter((entry) => entry.kind === "action")
                .map((entry) => [entry.id, entry] as const)
        );
        expect(byId.get("read-all")).toEqual({
            kind: "action",
            id: "read-all",
            label: "Read all functions (?)",
            disabled: false,
        });
        expect(byId.get("export-all")?.disabled).toBe(false);
        expect(byId.get("read-unread")?.disabled).toBe(true);
    });

    it("disables every queue action without a destination", () => {
        const entries = buildHouseQueueMenu(
            "NPCs",
            { all: 2, changed: 1, unread: 1, shown: 2, new: 1 },
            false
        );
        expect(
            entries
                .filter((entry) => entry.kind === "action")
                .every((entry) => entry.disabled)
        ).toBe(true);
    });
});

describe("Houses queue target decisions", () => {
    it("uses the active selection instead of the clicked row", () => {
        expect(queueNamesForRow(["Alpha", "Beta"], "Gamma")).toEqual(["Alpha", "Beta"]);
        expect(queueNamesForRow([], "Gamma")).toEqual(["Gamma"]);
    });

    it("finds only declared overwrite candidates and preserves unknown parsing", () => {
        expect(
            declaredOverwriteNames(
                ["New", "Existing", "Changed"],
                new Set(["Existing", "Changed", "Elsewhere"])
            )
        ).toEqual(["Existing", "Changed"]);
        expect(declaredOverwriteNames(["Existing"], null)).toBeNull();
    });
});

describe("Houses overwrite confirmation", () => {
    it("skips safe exports and reports the exact destructive count", () => {
        expect(buildOverwriteConfirmation("functions", [])).toBeNull();
        expect(buildOverwriteConfirmation("functions", ["One", "Two", "Three"])).toEqual({
            title: "Overwrite existing functions (3)?",
            lines: [
                "• One",
                "• Two",
                "• Three",
                "Export replaces the local versions with the house versions.",
            ],
        });
    });

    it("uses the conservative warning when declarations are unavailable", () => {
        expect(buildOverwriteConfirmation("functions", null)).toEqual({
            title: "Overwrite local files?",
            lines: [
                "HTSW couldn't verify which entries already exist in the destination.",
                "Export may replace local versions with the house versions.",
            ],
        });
    });
});
