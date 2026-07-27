import { describe, expect, it } from "vitest";
import type { ImportableFunction } from "htsw/types";

import {
    conflictIdentifier,
    importableWithSkippedConflictLists,
    resolveImportConflicts,
} from "../src/importables/import/conflictResolution";
import { message } from "./utils";

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
            new Map([[conflictIdentifier(conflict), observed]])
        );

        expect(resolved).toEqual({ ...desired, actions: observed });
        expect(desired.actions).toEqual([message("source")]);
    });
});
