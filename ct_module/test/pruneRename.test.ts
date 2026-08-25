import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    commands: [] as string[],
    // confirmations Housing will send back, keyed by command
    confirms: new Set<string>(),
}));

vi.mock("../src/housingSync/menus/menuWaiters", () => ({
    chatMessage: (message: string) => ({ label: message, message }),
}));
vi.mock("../src/tasks/manager", () => ({ isTaskCancelled: () => false }));

import { applyRenames, detectRenames } from "../src/prune/rename";
import { readHouseLock } from "../src/importCache/houseLock";
import type TaskContext from "../src/tasks/context";
import type { PrunableType } from "../src/prune/registry";

const manifestPath = "./projects/demo/import.json";
const lockPath = "./projects/demo/house.lock.json";

let files: Partial<Record<string, string>> = {};

// stands in for the context's command/wait pair: the wait resolves only when
// Housing was set up to confirm that command
function renameCtx(): TaskContext {
    return {
        checkCancelled: () => undefined,
        runCommand: async (command: string) => {
            mocks.commands.push(command);
        },
        expectAfter: async (send: () => Promise<void>) => {
            await send();
            const command = mocks.commands[mocks.commands.length - 1];
            if (!mocks.confirms.has(command)) {
                throw new Error("Waiting for message in chat: timed out");
            }
        },
    } as unknown as TaskContext;
}

function stubLock(entries: { type: string; identity: string }[]): void {
    files = {};
    const importables: Record<string, unknown> = {};
    for (const entry of entries) {
        importables[`${entry.type}:${entry.identity}`] = {
            type: entry.type,
            identity: entry.identity,
            hash: "0xhash",
            listScanHashes: { actions: "0xscan" },
        };
    }
    files[lockPath] = JSON.stringify({
        schemaVersion: 1,
        houseUuid: "house-1",
        importables,
    });
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files[path] !== undefined,
        read: (path: string) => files[path] ?? null,
        write: (path: string, content: string) => {
            files[path] = content;
        },
    });
}

function map(
    entries: [PrunableType, string[]][]
): Map<PrunableType, readonly string[]> {
    return new Map(entries);
}

beforeEach(() => {
    mocks.commands = [];
    mocks.confirms = new Set();
    stubLock([]);
    vi.stubGlobal("Java", { type: () => new Proxy({}, { get: () => () => undefined }) });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("detectRenames", () => {
    it("pairs a single removal with a single addition", () => {
        expect(
            detectRenames(map([["FUNCTION", ["Old"]]]), map([["FUNCTION", ["New"]]]))
        ).toEqual([{ type: "FUNCTION", from: "Old", to: "New" }]);
    });

    it("refuses to guess when either side has more than one name", () => {
        expect(
            detectRenames(
                map([["FUNCTION", ["OldA", "OldB"]]]),
                map([["FUNCTION", ["New"]]])
            )
        ).toEqual([]);
        expect(
            detectRenames(
                map([["FUNCTION", ["Old"]]]),
                map([["FUNCTION", ["NewA", "NewB"]]])
            )
        ).toEqual([]);
    });

    it("only renames types whose rename Housing announces", () => {
        expect(
            detectRenames(map([["MENU", ["Old"]]]), map([["MENU", ["New"]]]))
        ).toEqual([]);
        expect(
            detectRenames(map([["REGION", ["Old"]]]), map([["REGION", ["New"]]]))
        ).toEqual([{ type: "REGION", from: "Old", to: "New" }]);
    });

    it("skips names that would make Housing's confirmation ambiguous", () => {
        expect(
            detectRenames(
                map([["FUNCTION", ["Go to Spawn"]]]),
                map([["FUNCTION", ["Spawn"]]])
            )
        ).toEqual([]);
    });
});

describe("applyRenames", () => {
    it("renames in the house and moves the baseline with its hashes", async () => {
        stubLock([{ type: "FUNCTION", identity: "Old" }]);
        mocks.confirms.add("/function rename Old New");

        const outcome = await applyRenames(renameCtx(), manifestPath, [
            { type: "FUNCTION", from: "Old", to: "New" },
        ]);

        expect(outcome.renamed).toEqual([
            { type: "FUNCTION", from: "Old", to: "New" },
        ]);
        expect(outcome.unconfirmed).toEqual([]);
        const lock = readHouseLock(manifestPath);
        expect(Object.keys(lock?.importables ?? {})).toEqual(["FUNCTION:New"]);
        expect(lock?.importables["FUNCTION:New"]).toMatchObject({
            identity: "New",
            hash: "0xhash",
        });
    });

    // an unconfirmed rename leaves the old name in the house
    it("reports a rename Housing never confirmed and leaves the baseline alone", async () => {
        stubLock([{ type: "FUNCTION", identity: "Old" }]);

        const outcome = await applyRenames(renameCtx(), manifestPath, [
            { type: "FUNCTION", from: "Old", to: "New" },
        ]);

        expect(outcome.renamed).toEqual([]);
        expect(outcome.unconfirmed).toEqual([
            { type: "FUNCTION", from: "Old", to: "New" },
        ]);
        expect(Object.keys(readHouseLock(manifestPath)?.importables ?? {})).toEqual([
            "FUNCTION:Old",
        ]);
    });

    it("refuses to move a baseline onto one that already exists", async () => {
        stubLock([
            { type: "FUNCTION", identity: "Old" },
            { type: "FUNCTION", identity: "New" },
        ]);
        mocks.confirms.add("/function rename Old New");

        await applyRenames(renameCtx(), manifestPath, [
            { type: "FUNCTION", from: "Old", to: "New" },
        ]);

        expect(
            Object.keys(readHouseLock(manifestPath)?.importables ?? {}).sort()
        ).toEqual(["FUNCTION:New", "FUNCTION:Old"]);
    });
});
