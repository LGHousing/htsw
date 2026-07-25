import { beforeEach, describe, expect, test, vi } from "vitest";

const io = vi.hoisted(() => ({
    atomicWriteText: vi.fn(() => true),
}));

vi.mock("../src/utils/filesystem", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/utils/filesystem")>()),
    atomicWriteText: io.atomicWriteText,
    getFileMtimeMs: () => 1,
}));

import { readImportableCache } from "../src/importCache";
import { readCachedActionList } from "../src/importCache/actionLists";
import { estimateActionListPhaseUnits } from "../src/housingSync/progress/costs";
import { recordEmptyFunctionShell } from "../src/importables/import/emptyShells";
import type { ImportContext } from "../src/importables/import/context";
import type TaskContext from "../src/tasks/context";
import { message } from "./utils";

describe("empty shell cache", () => {
    beforeEach(() => {
        io.atomicWriteText.mockClear();
    });

    test("reads a creation-time function entry as an empty estimate baseline", async () => {
        const session = {
            housingUuid: "empty-shell-house",
        } as unknown as ImportContext;
        const ctx = { displayMessage: vi.fn() } as unknown as TaskContext;

        await recordEmptyFunctionShell(ctx, session, "Fresh");

        const entry = readImportableCache(
            "empty-shell-house",
            "FUNCTION",
            "Fresh"
        );
        expect(entry?.importable).toEqual({
            type: "FUNCTION",
            name: "Fresh",
            actions: [],
        });
        expect(entry?.lists.actions).toEqual([]);
        const baseline =
            entry === null
                ? undefined
                : readCachedActionList(entry.importable, "actions");
        expect(baseline).toEqual([]);
        expect(
            estimateActionListPhaseUnits([message("desired")], baseline)
        ).toMatchObject({
            reading: 0,
            hydrating: 0,
        });
    });
});
