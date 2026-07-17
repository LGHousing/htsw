import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

import { scanConflictVerdict } from "../src/importables/importConflicts";
import { actionListScanHashFromActions } from "../src/housingSync/actions/scanHash";
import { createItemRegistry } from "../src/importables/itemRegistry";
import { createNpcLookupCache } from "../src/importables/npcs/listNpcs";
import type { ImportSession } from "../src/importables/imports";
import type TaskContext from "../src/tasks/context";
import { changeVar, message, observedSlot, playSound } from "./utils";

const mocks = vi.hoisted(() => ({
    scanActionList: vi.fn(),
    hydrateActionListScan: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/actions/readList", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: mocks.scanActionList,
}));

vi.mock("../src/housingSync/actions/hydration/run", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../src/housingSync/actions/hydration/run")
    >()),
    hydrateActionListScan: mocks.hydrateActionListScan,
}));

import { prereadActionList } from "../src/housingSync/actions/plan";

describe("scanConflictVerdict", () => {
    it.each([
        ["live", undefined, "source", "no-baseline"],
        ["baseline", "baseline", "source", "unchanged"],
        ["source", "baseline", "source", "already-applied"],
        ["live", "baseline", "source", "conflict"],
    ] as const)("returns %s/%s/%s as %s", (liveHash, lockHash, sourceHash, verdict) => {
        expect(scanConflictVerdict(liveHash, lockHash, sourceHash)).toBe(verdict);
    });
});

describe("prereadActionList conflict detection", () => {
    beforeEach(() => {
        mocks.scanActionList.mockReset();
        mocks.hydrateActionListScan.mockClear();
    });

    it("records a live scan that differs from both the lock and source", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [playSound()],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, changeVar())],
        });
        const session: ImportSession = {
            parsed: { value: [] } as never,
            items: createItemRegistry([]),
            housingUuid: "test-house",
            trust: {
                housingUuid: "test-house",
                trustMode: true,
                importables: new Map([
                    [
                        "FUNCTION:Debug",
                        {
                            importable,
                            identity: importable.name,
                            entry: null,
                            sourceHash: "",
                            cacheHash: null,
                            lockHash: null,
                            lockListScanHashes: {
                                actions: actionListScanHashFromActions([
                                    message("baseline"),
                                ]),
                            },
                            cacheMatchesLock: true,
                            trustMode: false,
                            wholeImportableTrusted: false,
                            trustedChildListPaths: new Set(),
                            trustedChildLists: new Map(),
                        },
                    ],
                ]),
            },
            conflicts: [],
            events: undefined,
            npcLookup: createNpcLookupCache(),
        };

        await prereadActionList(null as unknown as TaskContext, importable.actions!, {
            session,
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(session.conflicts).toEqual([
            { type: "FUNCTION", identity: "Debug", basePath: "actions" },
        ]);
    });
});
