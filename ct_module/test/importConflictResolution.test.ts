import { describe, expect, it } from "vitest";
import type { ImportableFunction } from "htsw/types";

import {
    importableWithSkippedConflictLists,
    resolveImportConflictPolicy,
    resolveImportConflicts,
} from "../src/importables/import/conflictResolution";
import { actionSyncConflictIdentifier } from "../src/housingSync/actions/syncContext";
import { message, observedSlot } from "./utils";

const conflicts = [
    { type: "ITEM" as const, identity: "Wand", basePath: "leftClickActions" },
    { type: "ITEM" as const, identity: "Wand", basePath: "rightClickActions" },
    { type: "FUNCTION" as const, identity: "Debug", basePath: "actions" },
];

describe("per-list import conflict resolution", () => {
    it("accepts either every list for an importable or one exact base path", () => {
        expect(
            resolveImportConflicts(conflicts, [
                "ITEM:Wand:leftClickActions",
                "FUNCTION:Debug",
            ])
        ).toEqual({
            accepted: [conflicts[0], conflicts[2]],
            skipped: [conflicts[1]],
        });
    });

    it("rejects an unmatched accept and lists actual identifiers", () => {
        expect(() =>
            resolveImportConflicts(conflicts, ["ITEM:Wnad"])
        ).toThrow(
            "--accept did not match any conflicted list: ITEM:Wnad " +
                "(conflicts: ITEM:Wand:leftClickActions, " +
                "ITEM:Wand:rightClickActions, FUNCTION:Debug:actions)"
        );
    });

    it("rejects an unmatched exact selector", () => {
        const selector = "ITEM:Wand:middleClickActions";
        expect(() => resolveImportConflicts(conflicts, [selector])).toThrow(
            `--accept did not match any conflicted list: ${selector}`
        );
    });

    it("resolves cancel plus complete accepts without cancelling", () => {
        expect(
            resolveImportConflictPolicy(
                [conflicts[2]],
                ["FUNCTION:Debug"],
                "cancel"
            )
        ).toEqual({
            kind: "resolved",
            resolution: { accepted: [conflicts[2]], skipped: [] },
        });
    });

    it("resolves skip plus a named accept per list", () => {
        expect(
            resolveImportConflictPolicy(
                conflicts.slice(0, 2),
                ["ITEM:Wand:leftClickActions"],
                "skip"
            )
        ).toEqual({
            kind: "resolved",
            resolution: {
                accepted: [conflicts[0]],
                skipped: [conflicts[1]],
            },
        });
    });

    it("persists observed content for a skipped list", () => {
        const desired: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("source")],
        };
        const conflict = conflicts[2];
        const observed = [message("live")];
        const resolved = importableWithSkippedConflictLists(
            desired,
            [conflict],
            new Map([
                [
                    actionSyncConflictIdentifier(conflict),
                    { kind: "actions" as const, actions: observed },
                ],
            ])
        );

        expect(resolved).toEqual({ ...desired, actions: observed });
        expect(desired.actions).toEqual([message("source")]);
    });

    it("rejects an incomplete observed skipped list", () => {
        const desired: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("source")],
        };
        const conflict = conflicts[2];
        const unknown = observedSlot(0, message("unreadable"));
        unknown.action = null;
        unknown.hydrated = false;

        expect(() =>
            importableWithSkippedConflictLists(
                desired,
                [conflict],
                new Map([
                    [
                        actionSyncConflictIdentifier(conflict),
                        { kind: "slots" as const, slots: [unknown] },
                    ],
                ])
            )
        ).toThrow(
            "Cannot skip conflicted list FUNCTION:Debug:actions: " +
                "its live contents could not be read completely."
        );
    });
});
