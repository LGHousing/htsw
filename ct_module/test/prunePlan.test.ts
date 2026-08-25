import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Importable } from "htsw/types";

const mocks = vi.hoisted(() => ({
    functions: [] as string[],
    menus: [] as string[],
    regions: [] as string[],
    commands: [] as string[],
    teams: [] as string[],
    groups: [] as string[],
    npcs: [] as { name: string; pos: { x: number; y: number; z: number } }[],
    menuListError: null as string | null,
    eventCache: new Map<string, Importable | null>(),
}));

vi.mock("../src/importables/functions/listFunctions", () => ({
    listAllFunctionNames: async () => mocks.functions,
}));
vi.mock("../src/importables/menus/listMenus", () => ({
    listAllMenuNames: async () => {
        if (mocks.menuListError !== null) throw new Error(mocks.menuListError);
        return mocks.menus;
    },
}));
vi.mock("../src/importables/regions/listRegions", () => ({
    listAllRegionNames: async () => mocks.regions,
}));
vi.mock("../src/importables/commands/listCommands", () => ({
    listAllCommandNames: async () => mocks.commands,
}));
vi.mock("../src/importables/teams/listTeams", () => ({
    listAllTeamNames: async () => mocks.teams,
    deleteTeam: async () => undefined,
}));
vi.mock("../src/importables/groups/listGroups", () => ({
    listAllGroupNames: async () => mocks.groups,
    deleteGroup: async () => undefined,
}));
vi.mock("../src/importables/npcs/listNpcs", () => ({
    listAllNpcs: async () => mocks.npcs,
    npcLabel: (entry: { name: string; pos: { x: number; y: number; z: number } }) =>
        `${entry.name} @ ${entry.pos.x},${entry.pos.y},${entry.pos.z}`,
}));
vi.mock("../src/importCache/cache", () => ({
    recordHouseScan: () => undefined,
    listCachedImportables: () => [],
    readImportableCache: (_uuid: string, type: string, identity: string) => {
        const importable = mocks.eventCache.get(`${type}:${identity}`);
        if (importable === undefined) return null;
        return { verified: true, importable };
    },
}));

import { scanHousePrunePlan, vanishedPrunePlan } from "../src/prune/plan";
import type TaskContext from "../src/tasks/context";
import type { PrunableType } from "../src/prune/registry";

const importJsonPath = "./projects/demo/import.json";
const lockPath = "./projects/demo/house.lock.json";
const HOUSE = "house-1";

const ctx = { checkCancelled: () => undefined } as unknown as TaskContext;

function stubLock(entries: { type: string; identity: string }[] | null): void {
    const files: Partial<Record<string, string>> = {};
    if (entries !== null) {
        const importables: Record<string, unknown> = {};
        for (const entry of entries) {
            importables[`${entry.type}:${entry.identity}`] = {
                type: entry.type,
                identity: entry.identity,
                hash: "0xhash",
            };
        }
        files[lockPath] = JSON.stringify({
            schemaVersion: 1,
            houseUuid: HOUSE,
            importables,
        });
    }
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files[path] !== undefined,
        read: (path: string) => files[path] ?? null,
        write: (path: string, content: string) => {
            files[path] = content;
        },
    });
}

function fn(name: string): Importable {
    return { type: "FUNCTION", name, actions: [] };
}

function scan(declared: Importable[], types: PrunableType[]) {
    return scanHousePrunePlan(ctx, {
        declared,
        housingUuid: HOUSE,
        importJsonPath,
        types,
    });
}

beforeEach(() => {
    mocks.functions = [];
    mocks.menus = [];
    mocks.regions = [];
    mocks.commands = [];
    mocks.teams = [];
    mocks.groups = [];
    mocks.npcs = [];
    mocks.eventCache = new Map();
    mocks.menuListError = null;
    stubLock(null);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("scanHousePrunePlan", () => {
    it("finds nothing when the house matches the manifest", async () => {
        mocks.functions = ["Main", "Helper"];

        const plan = await scan([fn("Main"), fn("Helper")], ["FUNCTION"]);

        expect(plan.targets).toEqual([]);
        expect(plan.scanFailures).toEqual([]);
    });

    it("targets house content the manifest does not declare", async () => {
        mocks.functions = ["Main", "Leftover"];

        const plan = await scan([fn("Main")], ["FUNCTION"]);

        expect(plan.targets.map((target) => target.identity)).toEqual(["Leftover"]);
        expect(plan.targets[0].method).toBe("delete");
    });

    it("matches declarations against house names case-insensitively", async () => {
        mocks.functions = ["main", " Helper "];

        const plan = await scan([fn("Main"), fn("helper")], ["FUNCTION"]);

        expect(plan.targets).toEqual([]);
    });

    it("marks a target owned when the lock recorded it", async () => {
        mocks.functions = ["Imported", "HandMade"];
        stubLock([{ type: "FUNCTION", identity: "Imported" }]);

        const plan = await scan([], ["FUNCTION"]);

        expect(
            plan.targets.map((target) => [target.identity, target.owned])
        ).toEqual([
            ["Imported", true],
            ["HandMade", false],
        ]);
    });

    it("never targets Housing's built-in commands", async () => {
        mocks.commands = ["stuck", "clear", "Custom"];

        const plan = await scan([], ["COMMAND"]);

        expect(plan.targets.map((target) => target.identity)).toEqual(["Custom"]);
    });

    it("plans to clear undeclared events but never to delete them", async () => {
        const plan = await scan(
            [{ type: "EVENT", event: "Player Join", actions: [] }],
            ["EVENT"]
        );

        expect(plan.targets.every((target) => target.method === "clearActions")).toBe(
            true
        );
        expect(plan.targets.map((target) => target.identity)).not.toContain(
            "Player Join"
        );
        expect(plan.targets.map((target) => target.identity)).toContain("Player Quit");
    });

    it("leaves out events the cache has verified as already empty", async () => {
        mocks.eventCache.set("EVENT:Player Quit", {
            type: "EVENT",
            event: "Player Quit",
            actions: [],
        });

        const plan = await scan([], ["EVENT"]);

        expect(plan.targets.map((target) => target.identity)).not.toContain(
            "Player Quit"
        );
    });

    it("keeps an event whose cached content still has actions", async () => {
        mocks.eventCache.set("EVENT:Player Quit", {
            type: "EVENT",
            event: "Player Quit",
            actions: [{ type: "MESSAGE", message: "bye" }],
        });

        const plan = await scan([], ["EVENT"]);

        expect(plan.targets.map((target) => target.identity)).toContain("Player Quit");
    });

    it("reports undeclared NPCs instead of targeting them", async () => {
        mocks.npcs = [{ name: "Guide", pos: { x: 1, y: 2, z: 3 } }];

        const plan = await scan([], ["NPC"]);

        expect(plan.targets).toEqual([]);
        expect(plan.unsupported.map((target) => target.identity)).toEqual(["1,2,3"]);
    });

    it("records a failed scan and prunes nothing of that type", async () => {
        mocks.menuListError = "menu list did not open";
        mocks.functions = ["Leftover"];

        const plan = await scan([], ["MENU", "FUNCTION"]);

        expect(plan.scanFailures).toEqual([
            { type: "MENU", reason: "menu list did not open" },
        ]);
        // the failed type contributes nothing; the rest are planned normally
        expect(plan.targets.map((target) => target.identity)).toEqual(["Leftover"]);
    });
});

describe("vanishedPrunePlan", () => {
    it("is empty when the project has no lock", () => {
        expect(vanishedPrunePlan([fn("Main")], importJsonPath).targets).toEqual([]);
    });

    it("targets a locked importable the manifest stopped declaring", () => {
        stubLock([
            { type: "FUNCTION", identity: "Main" },
            { type: "FUNCTION", identity: "Removed" },
        ]);

        const plan = vanishedPrunePlan([fn("Main")], importJsonPath);

        expect(plan.targets.map((target) => target.identity)).toEqual(["Removed"]);
        expect(plan.targets[0].owned).toBe(true);
    });

    it("ignores locked entries of types a prune cannot act on", () => {
        stubLock([{ type: "ITEM", identity: "Token" }]);

        expect(vanishedPrunePlan([], importJsonPath).targets).toEqual([]);
    });

    it("does not report NPCs, which it cannot remove", () => {
        stubLock([{ type: "NPC", identity: "1,2,3" }]);

        expect(vanishedPrunePlan([], importJsonPath).targets).toEqual([]);
    });
});
