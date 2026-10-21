import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    commands: [] as string[],
    // confirmations Housing will send back, keyed by command
    confirms: new Set<string>(),
    refusal: null as string | null,
}));

vi.mock("../src/tasks/manager", () => ({ isTaskCancelled: () => false }));
vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: (path: string, content: string) => {
        FileLib.write(path, content, true);
        return true;
    },
}));

import { applyRenames, detectRenames } from "../src/prune/rename";
import { readHouseLock } from "../src/importCache/houseLock";
import TaskContext from "../src/tasks/context";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";
import type { PrunableType } from "../src/prune/registry";

const manifestPath = "./projects/demo/import.json";
const lockPath = "./projects/demo/house.lock.json";

let files: Partial<Record<string, string>> = {};

// Deliver replies during the send, just as a fast Housing connection can.
function renameCtx(): TaskContext {
    const ctx = Object.create(TaskContext.prototype) as TaskContext;
    const listeners = new Set<(message: string) => void>();
    ctx.checkCancelled = () => {};
    ctx.withTimeout = ((promise: WaitForPromise<unknown>) =>
        promise) as typeof ctx.withTimeout;
    ctx.waitFor = ((_event: string, check: (message: string) => boolean) => {
        let receive!: (message: string) => void;
        const promise = new Promise<[string]>((resolve) => {
            receive = (message) => {
                if (check(message)) resolve([message]);
            };
            listeners.add(receive);
        }) as WaitForPromise<[string]>;
        promise.cleanupWaiter = () => listeners.delete(receive);
        return promise;
    }) as typeof ctx.waitFor;
    ctx.runCommand = async (command: string) => {
        mocks.commands.push(command);
        if (mocks.refusal !== null) {
            for (const receive of listeners) receive(mocks.refusal);
        } else if (mocks.confirms.has(command)) {
            const [, type, , from, to] = command.match(/^\/(\w+) (rename) (\S+) (\S+)$/)!;
            for (const receive of listeners) receive(`Renamed ${type} ${from} to ${to}`);
        } else {
            throw new Error("Waiting for message in chat: timed out");
        }
    };
    return ctx;
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

function map(entries: [PrunableType, string[]][]): Map<PrunableType, readonly string[]> {
    return new Map(entries);
}

beforeEach(() => {
    mocks.commands = [];
    mocks.refusal = null;
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
        expect(detectRenames(map([["MENU", ["Old"]]]), map([["MENU", ["New"]]]))).toEqual(
            []
        );
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

        expect(outcome.renamed).toEqual([{ type: "FUNCTION", from: "Old", to: "New" }]);
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

    it("stops on a filter rejection without falling back to delete-and-create", async () => {
        stubLock([{ type: "FUNCTION", identity: "Old" }]);
        mocks.refusal = "The function name contains blocked words! (1)";
        await expect(
            applyRenames(renameCtx(), manifestPath, [
                { type: "FUNCTION", from: "Old", to: "n19" },
            ])
        ).rejects.toThrow(
            'Hypixel\'s chat filter rejected "n19" for Function name; rename it'
        );
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
