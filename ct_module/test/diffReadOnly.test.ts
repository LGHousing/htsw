import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    Action,
    ImportableCommand,
    ImportableFunction,
} from "htsw/types";

import {
    actionListConflictVerdict,
    type ActionListConflictVerdict,
} from "../src/housingSync/actions/conflicts";
import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type TaskContext from "../src/tasks/context";
import { changeVar, message, playSound } from "./utils";

const cacheMocks = vi.hoisted(() => ({
    writeImportableCache: vi.fn(),
    readImportableCache: vi.fn(),
}));

const lockMocks = vi.hoisted(() => ({
    upsertHouseLockImportable: vi.fn(
        (_path: string, _housingUuid: string, _update: unknown) => true
    ),
}));

vi.mock("../src/importCache/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache/cache")>()),
    writeImportableCache: cacheMocks.writeImportableCache,
    readImportableCache: cacheMocks.readImportableCache,
}));

vi.mock("../src/importCache/houseLock", () => ({
    upsertHouseLockImportable: lockMocks.upsertHouseLockImportable,
}));

vi.mock("../src/importCache/housingId", () => ({
    getCurrentHousingUuid: async () => "house",
}));

import { defineHouseExporter } from "../src/importables/export/exporter";
import { readDiffImportables } from "../src/slashCommands/diff";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";

describe("diff live reads", () => {
    beforeEach(() => {
        cacheMocks.writeImportableCache.mockReset();
        cacheMocks.readImportableCache.mockReset();
        cacheMocks.readImportableCache.mockReturnValue(null);
        lockMocks.upsertHouseLockImportable.mockClear();
    });

    it("leave the importer cache and a subsequent conflict verdict unchanged", async () => {
        const baseline: Action[] = [message("baseline")];
        const source: Action[] = [playSound()];
        const live: Action[] = [changeVar()];
        let importerBaseline = baseline;
        cacheMocks.writeImportableCache.mockImplementation(
            (_ctx: TaskContext, _housingUuid: string, importable: ImportableFunction) => {
                importerBaseline = importable.actions ?? [];
                return true;
            }
        );
        const subsequentVerdict = (): ActionListConflictVerdict | null =>
            actionListConflictVerdict(
                { actions: live },
                {
                    contentHash: actionListContentHashFromActions(importerBaseline),
                    scanHash: actionListScanHashFromActions(importerBaseline),
                },
                source,
                "content"
            );
        const before = subsequentVerdict();
        const accepted: ImportableFunction[] = [];
        const read = defineHouseExporter({
            type: "FUNCTION",
            noun: "function",
            list: async () => ["Debug"],
            reader: {
                kind: "direct",
                read: async () => func("Debug", live),
            },
            importableOf: (importable) => importable,
            export: async () => undefined,
        });

        await read(
            {
                checkCancelled: () => undefined,
                displayMessage: () => undefined,
            } as unknown as TaskContext,
            {
                importJsonPath: "import.json",
                rootDir: "",
                names: ["Debug"],
                quiet: true,
                output: {
                    kind: "memory",
                    housingUuid: "house",
                    accept: (importable) =>
                        accepted.push(importable as ImportableFunction),
                },
            }
        );

        expect(before).toBe("conflict");
        expect(accepted).toEqual([func("Debug", live)]);
        expect(cacheMocks.writeImportableCache).not.toHaveBeenCalled();
        expect(importerBaseline).toEqual(baseline);
        expect(subsequentVerdict()).toBe(before);
    });

    it("keeps colliding capture names owned by their reader results", async () => {
        const functionReader = defineHouseExporter({
            type: "FUNCTION",
            noun: "function",
            list: async () => ["First"],
            reader: {
                kind: "direct",
                read: async (
                    _ctx,
                    _entry,
                    _options,
                    state
                ): Promise<ImportableFunction> => {
                    const itemName = state.itemCaptures.register(
                        '{id:"minecraft:cookie"}',
                        "Collision"
                    );
                    return func("First", [
                        { type: "GIVE_ITEM", itemName },
                    ]);
                },
            },
            importableOf: (importable) => importable,
            export: async () => undefined,
        });
        const commandReader = defineHouseExporter({
            type: "COMMAND",
            noun: "command",
            list: async () => ["Second"],
            reader: {
                kind: "direct",
                read: async (
                    _ctx,
                    _entry,
                    _options,
                    state
                ): Promise<ImportableCommand> => {
                    const itemName = state.itemCaptures.register(
                        '{id:"minecraft:apple"}',
                        "Collision"
                    );
                    return {
                        type: "COMMAND",
                        name: "Second",
                        actions: [
                            { type: "GIVE_ITEM", itemName },
                        ],
                    };
                },
            },
            importableOf: (importable) => importable,
            export: async () => undefined,
        });
        const source: Array<ImportableFunction | ImportableCommand> = [
            func("First", [{ type: "GIVE_ITEM", itemName: "cookie" }]),
            {
                type: "COMMAND",
                name: "Second",
                actions: [
                    { type: "GIVE_ITEM", itemName: "apple" },
                ],
            },
        ];
        const live = await readDiffImportables(
            {
                checkCancelled: () => undefined,
                displayMessage: () => undefined,
            } as unknown as TaskContext,
            "",
            "house",
            { value: source } as never,
            { sinkFor: () => undefined } as never,
            {
                FUNCTION: functionReader,
                COMMAND: commandReader,
            }
        );
        const first = live.get("FUNCTION:First")!;
        const second = live.get("COMMAND:Second")!;
        const firstAction = (first.importable as ImportableFunction).actions![0] as
            Action & { itemName: string };
        const secondAction = (second.importable as ImportableCommand).actions![0] as
            Action & { itemName: string };

        expect(firstAction.itemName).toBe("collision");
        expect(secondAction.itemName).toBe("collision");
        expect(first.itemContent(firstAction, "itemName")?.key).toBe(
            canonicalItemShellTagKey({
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:cookie" },
                },
            })
        );
        expect(second.itemContent(secondAction, "itemName")?.key).toBe(
            canonicalItemShellTagKey({
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:apple" },
                },
            })
        );
    });

    it("passes captured item content when locking a cached export object", async () => {
        const cachedItem = {
            type: "GIVE_ITEM",
            itemName: "cookie",
        } as Action;
        const cached = func("Cached", [cachedItem]);
        cacheMocks.readImportableCache.mockReturnValue({
            importable: cached,
            writer: "exporter",
        });
        const read = defineHouseExporter({
            type: "FUNCTION",
            noun: "function",
            list: async () => ["Cached"],
            reader: {
                kind: "direct",
                read: async (_ctx, _entry, _options, state) => {
                    const itemName = state.itemCaptures.register(
                        '{id:"minecraft:cookie"}',
                        "Cookie"
                    );
                    return func("Cached", [
                        { type: "GIVE_ITEM", itemName },
                    ]);
                },
            },
            importableOf: (importable) => importable,
            export: async () => undefined,
        });

        await read(
            {
                checkCancelled: () => undefined,
                displayMessage: () => undefined,
            } as unknown as TaskContext,
            {
                importJsonPath: "",
                rootDir: "",
                names: ["Cached"],
                quiet: true,
                output: { kind: "project" },
            }
        );

        const update = lockMocks.upsertHouseLockImportable.mock.calls[0][2] as {
            importable: ImportableFunction;
            itemContent: (
                owner: Action,
                property: string
            ) => { key: string } | undefined;
        };
        expect(update.importable).toBe(cached);
        expect(update.itemContent(cachedItem, "itemName")?.key).toBe(
            canonicalItemShellTagKey({
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:cookie" },
                },
            })
        );
    });
});

function func(name: string, actions: ImportableFunction["actions"]): ImportableFunction {
    return { type: "FUNCTION", name, actions };
}
