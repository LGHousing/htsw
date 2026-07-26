import { describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

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
}));

vi.mock("../src/importCache/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache/cache")>()),
    writeImportableCache: cacheMocks.writeImportableCache,
}));

import { defineHouseExporter } from "../src/importables/export/exporter";

describe("diff live reads", () => {
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
});

function func(name: string, actions: ImportableFunction["actions"]): ImportableFunction {
    return { type: "FUNCTION", name, actions };
}
