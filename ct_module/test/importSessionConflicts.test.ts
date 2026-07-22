import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

const mocks = vi.hoisted(() => ({
    applyImportablePlan: vi.fn(async () => undefined),
    scanImportable: vi.fn(),
    hydrateImportable: vi.fn(async () => undefined),
    tryWriteImportableCache: vi.fn(async () => true),
    upsertHouseLockImportable: vi.fn(),
}));

vi.mock("../src/importables/import/importers", () => ({
    scanImportable: mocks.scanImportable,
}));

vi.mock("../src/importCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache")>()),
    buildTrustPlan: (
        housingUuid: string,
        importables: readonly ImportableFunction[],
        trustMode: boolean
    ) => ({
        housingUuid,
        trustMode,
        importables: new Map(
            importables.map((importable) => [
                `${importable.type}:${importable.name}`,
                {
                    importable,
                    identity: importable.name,
                    entry: null,
                    sourceHash: "",
                    cacheHash: null,
                    lockHash: null,
                    lockListScanHashes: { actions: "baseline" },
                    cacheMatchesLock: true,
                    trustMode: false,
                    wholeImportableTrusted: false,
                    trustedChildListPaths: new Set(),
                    trustedChildLists: new Map(),
                },
            ])
        ),
    }),
    tryWriteImportableCache: mocks.tryWriteImportableCache,
}));

vi.mock("../src/importCache/houseLock", () => ({
    upsertHouseLockImportable: mocks.upsertHouseLockImportable,
}));

import { runImportSession } from "../src/importables/import/session";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import type TaskContext from "../src/tasks/context";
import { message } from "./utils";

describe("import conflict gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips every planned row and leaves caches and the lock untouched on cancel", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: unknown,
                session: { actions: { conflicts: unknown[] } }
            ) => {
                session.actions.conflicts.push({
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                });
                return {
                    kind: "FUNCTION",
                    importable,
                    hydrate: mocks.hydrateImportable,
                    plan: () => ({
                        kind: "FUNCTION",
                        importable,
                        isNoOp: () => false,
                        apply: mocks.applyImportablePlan,
                        reconstructObserved: () => null,
                        reconstructPartial: () => null,
                    }),
                };
            }
        );
        const events: SyncEvent[] = [];
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables: [importable],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [importable] } as never,
            events: { emit: (event) => events.push(event) },
            confirmConflicts: async () => false,
        });

        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
        expect(mocks.upsertHouseLockImportable).not.toHaveBeenCalled();
        expect(events).toContainEqual({
            kind: "importableFinished",
            key: "./project/import.json|FUNCTION:Debug",
            status: "skipped",
        });
        expect(events[events.length - 1]).toEqual({ kind: "sessionFinished" });
        expect(messages).toContain(
            "&c[htsw] Import cancelled — Housing changed since the last import."
        );
    });
});
