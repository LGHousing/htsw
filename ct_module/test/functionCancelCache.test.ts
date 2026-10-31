import { expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";
import type { ImportableCacheEntry } from "@htsw/importer/importCache/cache";
import type { HouseLock } from "@htsw/importer/importCache/houseLock";

const state = vi.hoisted(() => {
    const lock: HouseLock = { schemaVersion: 1, houseUuid: "cancel-house", importables: {} };
    return { caches: new Map<string, ImportableCacheEntry>(), lock, scan: vi.fn() };
});

vi.mock("@htsw/importer/importables/import/importers", () => ({
    scanImportable: state.scan,
}));
vi.mock("@htsw/importer/importCache/cache", async (original) => ({
    ...(await original<typeof import("@htsw/importer/importCache/cache")>()),
    readImportableCache: (_house: string, _type: string, name: string) =>
        state.caches.get(name) ?? null,
    loadImportableCachesOffThread: (_requests: unknown, done: () => void) => done(),
    tryWriteImportableCache: async (
        _ctx: unknown,
        value: ImportableFunction,
        _writer: string,
        _house: string,
        options: Partial<ImportableCacheEntry>
    ) => {
        saveCache(value, options);
        return true;
    },
    deleteImportableCache: (_house: string, _type: string, name: string) => {
        state.caches.delete(name);
        return true;
    },
}));
vi.mock("@htsw/importer/importCache/houseLock", async (original) => ({
    ...(await original<typeof import("@htsw/importer/importCache/houseLock")>()),
    readHouseLock: () => state.lock,
    removeHouseLockImportables: (_path: string, rows: { identity: string }[]) => {
        for (const row of rows) delete state.lock.importables[`FUNCTION:${row.identity}`];
        return true;
    },
    upsertHouseLockImportablesOffThread: async (
        _path: string,
        _house: string,
        updates: {
            importable: ImportableFunction;
            itemDependencies?: ImportableCacheEntry["itemDependencies"];
        }[]
    ) => {
        for (const update of updates)
            saveLock(update.importable, update.itemDependencies);
        return true;
    },
}));

import { importableHash, listHashes } from "@htsw/importer/importCache/hash";
import { buildTrustPlan } from "@htsw/importer/importCache/trust";
import { runImportSession } from "@htsw/importer/importables/import/session";
import {
    planImportableFunction,
    reconstructObservedFunction,
} from "@htsw/importer/importables/functions/import";
import { createKnownActionListPlan } from "@htsw/importer/housingSync/actions/plan";
import { createTaskCancelledError } from "@htsw/importer/tasks/cancellation";
import type { ImportContext } from "@htsw/importer/importables/import/context";
import type TaskContext from "@htsw/importer/tasks/context";

function saveCache(value: ImportableFunction, options = {}) {
    state.caches.set(value.name, {
        schemaVersion: 2,
        writtenAt: new Date().toISOString(),
        writer: "importer",
        importable: value,
        hash: importableHash(value),
        lists: listHashes(value),
        ...options,
    });
}

function saveLock(
    value: ImportableFunction,
    itemDependencies?: ImportableCacheEntry["itemDependencies"]
) {
    state.lock.importables[`FUNCTION:${value.name}`] = {
        type: "FUNCTION",
        identity: value.name,
        hash: importableHash(value),
        itemDependencies,
    };
}

it("keeps completed and untouched sibling caches trusted after cancelling an apply", async () => {
    const before: ImportableFunction[] = ["Completed", "Interrupted", "Untouched"].map(
        (name) => ({
            type: "FUNCTION",
            name,
            description: "Existing description.",
            icon: { item: "minecraft:stone" },
            repeatTicks: 20,
            actions: [{ type: "MESSAGE", message: "before" }],
        })
    );
    const desired = before.map((value) => ({
        ...value,
        actions: [{ type: "MESSAGE" as const, message: "after" }],
    }));
    before.forEach((value) => {
        saveCache(value);
        saveLock(value);
    });
    state.scan.mockImplementation(
        async (
            _ctx: TaskContext,
            importable: ImportableFunction,
            session: ImportContext
        ) => {
            const trustPlan = session.actions.trust.importables.get(
                `FUNCTION:${importable.name}`
            );
            const observed = before.find((value) => value.name === importable.name)!;
            const plan = planImportableFunction({
                kind: "FUNCTION",
                importable,
                exists: true,
                trustPlan,
                // Exercise both live settings and settings reused from a trusted cache.
                settings:
                    importable.name === "Completed"
                        ? (observed as Required<
                              Pick<
                                  ImportableFunction,
                                  "description" | "icon" | "repeatTicks"
                              >
                          >)
                        : null,
                actions: {
                    kind: "planned",
                    plan: createKnownActionListPlan(
                        importable.actions!,
                        observed.actions!,
                        { sync: session.actions }
                    ),
                },
            });
            const applicationPlan = {
                steps: [{ key: "cache", kind: "work", units: 0.25 }],
                totalUnits: 0.25,
            };
            return {
                kind: "FUNCTION",
                importable,
                needsHydration: false,
                plan: () => ({
                    kind: "FUNCTION",
                    importable,
                    applicationPlan,
                    isNoOp: () => false,
                    apply: async () => {
                        if (importable.name === "Interrupted")
                            throw createTaskCancelledError();
                    },
                    reconstructObserved: () => reconstructObservedFunction(plan),
                    reconstructPartial: () => null,
                }),
            };
        }
    );
    await expect(
        runImportSession(
            {
                sleep: async () => undefined,
                displayMessage: () => undefined,
            } as unknown as TaskContext,
            {
                importables: desired,
                trustMode: true,
                housingUuid: "cancel-house",
                sourcePath: "./project/import.json",
                parsed: { value: desired } as never,
                conflictHandling: { kind: "proceed" },
            }
        )
    ).rejects.toMatchObject({ __taskCancelled: true });

    const retry = buildTrustPlan("cancel-house", desired, true, "./project/import.json");
    expect(retry.importables.get("FUNCTION:Completed")?.wholeImportableTrusted).toBe(
        true
    );
    expect(retry.importables.get("FUNCTION:Interrupted")?.entry).toBeNull();
    const untouched = retry.importables.get("FUNCTION:Untouched")!;
    expect(untouched.entry?.importable).toEqual(before[2]);
    expect(untouched.cacheMatchesLock).toBe(true);
    expect(untouched.trustMode).toBe(true);
});
