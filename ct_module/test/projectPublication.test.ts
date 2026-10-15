import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
    SourceMap,
    allReferencedPaths,
    attributeDiagnostics,
    parseImportablesResult,
    type FileLoader,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    files: new Map<string, string>(),
    scans: [] as unknown[],
    shellPlans: [] as unknown[],
}));

vi.mock("../src/utils/fileLoaders", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return {
        FileSystemFileLoader: class {
            fileExists = (p: string) => fs.existsSync(p);
            readFile = (p: string) => fs.readFileSync(p, "utf8");
            getParentPath = (p: string) => path.dirname(p);
            resolvePath = (base: string, other: string) => path.resolve(base, other);
        },
    };
});

vi.mock("../src/utils/fileMetadata", async () => {
    const fs = await import("node:fs");
    return {
        getMtimeMs: (p: string) => (fs.existsSync(p) ? Math.floor(fs.statSync(p).mtimeMs) : 0),
    };
});

vi.mock("../src/utils/java", () => ({
    runtimeString: (value: string) => value,
    javaType: () => ({
        get: (p: string) => {
            const self = {
                normalize: () => self,
                toAbsolutePath: () => self,
                toRealPath: () => self,
                toString: () => p,
            };
            return self;
        },
    }),
}));

// The house side of an import session: record what each read is asked for.
vi.mock("../src/importables/import/importers", () => ({
    scanImportable: async (_ctx: unknown, importable: Importable) => {
        mocks.scans.push(JSON.parse(JSON.stringify(importable)));
        throw new Error("house read stops here");
    },
}));
vi.mock("../src/importables/import/references", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importables/import/references")>()),
    planMissingReferencedShells: async (_ctx: unknown, importables: readonly Importable[]) => {
        mocks.shellPlans.push(importables.map((imp) => JSON.stringify(imp)));
        return { functions: [], menus: [], regions: [] };
    },
}));
vi.mock("../src/importCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache")>()),
    loadImportableCachesOffThread: (_requests: unknown, done: () => void) => done(),
}));
vi.mock("../src/importCache/hashMemo", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache/hashMemo")>()),
    warmImportableHashesOffThread: (_importables: unknown, done: () => void) => done(),
}));
vi.mock("../src/runtimeDebug/importFailureLog", () => ({
    writeTaskFailureLog: () => "failure.log",
}));

import { expandImportDependencies } from "../src/importables/import/dependencyExpansion";
import { collectReferencedImportables } from "../src/importables/import/referenceScanner";
import { runImportSession } from "../src/importables/import/session";
import { visitItemReferences } from "../src/importables/items/dependencies";
import { importableIdentity, importableKey } from "../src/importables/identity";
import { buildTrustPlan } from "../src/importCache/trust";
import { importableHash, listHashes } from "../src/importCache/hash";
import { memoizedImportableHash } from "../src/importCache/status";
import { cachePathForId } from "../src/importCache/paths";
import { getParseAt, parseImportJsonCurrent } from "../src/runtime/parsing/parses";
import { loadSnapshot } from "../src/runtime/parsing/parseSnapshot";
import {
    installProjectPublication,
    publishProject,
    restoreProjectPublication,
    type ProjectPublication,
} from "../src/project/publication";
import type TaskContext from "../src/tasks/context";

const HOUSE = "0f7d1c2e-3b4a-4c5d-8e6f-708192a3b4c5";

class NodeFileLoader implements FileLoader {
    fileExists = (path: string) => existsSync(path);
    readFile = (path: string) => readFileSync(path, "utf8");
    getParentPath = (path: string) => dirname(path);
    resolvePath = (base: string, other: string) => resolve(base, other);
}

const item = (display: string, id = "minecraft:stone") =>
    `{id: "${id}", Count: 1b, tag: {display: {Name: "${display}"}}}`;

// Cyclic functions, a self-call, an item chain, two items sharing a display
// name, a direct .snbt reference, an include, a missing include and a broken
// file owned by one function.
const DENSE: Record<string, string> = {
    "import.json": JSON.stringify({
        houseUuid: HOUSE,
        dangerouslyDeleteEverythingNotInThisFile: true,
        include: ["mod/import.json", "absent/import.json"],
        teams: [{ name: "Red" }, { name: "Blue" }],
        groups: [{ name: "Builder" }, { name: "Guest" }],
        items: [
            { name: "Wand", nbt: "items/wand.snbt", leftClickActions: "items/wand-left.htsl" },
            { name: "Gem", nbt: "items/gem.snbt" },
            { name: "Shiny Copy", nbt: "items/gem-copy.snbt" },
            { name: "Loop A", nbt: "items/stone.snbt", rightClickActions: "items/loop-a.htsl" },
            { name: "Loop B", nbt: "items/stone.snbt", rightClickActions: "items/loop-b.htsl" },
        ],
        functions: [
            { name: "A", actions: "fn/a.htsl" },
            { name: "B", actions: "fn/b.htsl" },
            { name: "Self", actions: "fn/self.htsl" },
            { name: "Broken", actions: "fn/broken.htsl" },
        ],
        menus: [
            {
                name: "Shop",
                size: 1,
                slots: [{ slot: 0, nbt: "items/gem.snbt", actions: "menu/buy.htsl" }],
            },
        ],
        regions: [
            {
                name: "Spawn",
                bounds: { from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 1, z: 1 } },
                onEnterActions: "region/enter.htsl",
            },
        ],
        events: [{ event: "Player Join", actions: "event/join.htsl" }],
        commands: [{ name: "go", actions: "cmd/go.htsl" }],
    }),
    "mod/import.json": JSON.stringify({
        functions: [{ name: "Mod Fn", actions: "mod.htsl" }],
        items: [{ name: "Mod Item", nbt: "../items/stone.snbt" }],
    }),
    "mod/mod.htsl": 'giveItem "Mod Item" true First_Available_Slot false\nfunction "A" false\n',
    "fn/a.htsl": [
        'function "B" false',
        'giveItem "Wand" true First_Available_Slot false',
        'giveItem "../items/direct.snbt" true First_Available_Slot false',
        'setTeam "Red"',
        'displayMenu "Shop"',
        'if and (inRegion "Spawn") {\n    chat "in spawn"\n}',
        "",
    ].join("\n"),
    "fn/b.htsl": 'function "A" false\nchangePlayerGroup "Builder" true\ngiveItem "Gem" true First_Available_Slot false\n',
    "fn/self.htsl": 'function "Self" false\ngiveItem "Loop A" true First_Available_Slot false\n',
    "fn/broken.htsl": "thisIsNotAnAction 1 2 3\n",
    "items/wand-left.htsl": 'giveItem "Gem" true First_Available_Slot false\n',
    "items/loop-a.htsl": 'giveItem "Loop B" true First_Available_Slot false\n',
    "items/loop-b.htsl": 'chat "end of the chain"\n',
    "items/wand.snbt": item("§6Wand", "minecraft:blaze_rod"),
    "items/gem.snbt": item("Shiny", "minecraft:emerald"),
    "items/gem-copy.snbt": item("Shiny", "minecraft:emerald"),
    "items/stone.snbt": '{id: "minecraft:stone", Count: 1b}',
    "items/direct.snbt": item("Direct"),
    "menu/buy.htsl": 'giveItem "Wand" true First_Available_Slot false\n',
    "region/enter.htsl": 'chat "hello"\n',
    "event/join.htsl": 'function "A" false\nsetTeam "Blue"\n',
    "cmd/go.htsl": 'displayMenu "Shop"\n',
};

// Click actions that give each other: HTSW refuses the import, and must refuse
// it the same way from a selected restore.
const ITEM_CYCLE: Record<string, string> = {
    "import.json": JSON.stringify({
        items: [
            { name: "Ping", nbt: "stone.snbt", rightClickActions: "ping.htsl" },
            { name: "Pong", nbt: "stone.snbt", rightClickActions: "pong.htsl" },
        ],
        functions: [{ name: "Serve", actions: "serve.htsl" }],
    }),
    "stone.snbt": '{id: "minecraft:stone", Count: 1b}',
    "ping.htsl": 'giveItem "Pong" true First_Available_Slot false\n',
    "pong.htsl": 'giveItem "Ping" true First_Available_Slot false\n',
    "serve.htsl": 'giveItem "Ping" true First_Available_Slot false\nfunction "Serve" false\n',
};

const FIXTURES = join(__dirname, "..", "inGameTestFixtures");

type Prepared = {
    name: string;
    manifest: ProjectPublication;
    bodies: string[];
    root: string;
    full: ImportablesParseResult;
};

const temp: string[] = [];

function writeProject(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "htsw-publication-"));
    temp.push(root);
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

function sources(parsed: ImportablesParseResult): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const path of allReferencedPaths(parsed.gcx.path, parsed)) {
        out[path] = existsSync(path)
            ? createHash("sha256").update(readFileSync(path)).digest("hex")
            : null;
    }
    return out;
}

/** Parse at one root, then restore the whole publication at a copy elsewhere. */
function prepare(name: string, source: string): Prepared {
    const parsed = parseImportablesResult(
        new SourceMap(new NodeFileLoader()),
        join(source, "import.json")
    );
    const published = publishProject(parsed, source, sources(parsed));
    const manifest = JSON.parse(JSON.stringify(published.manifest)) as ProjectPublication;
    const root = mkdtempSync(join(tmpdir(), "htsw-publication-copy-"));
    temp.push(root);
    cpSync(source, root, { recursive: true });
    const full = restoreProjectPublication(manifest, root, (i) => published.bodies[i]);
    return { name, manifest, bodies: published.bodies, root, full };
}

function seedHouseCache(parsed: ImportablesParseResult): void {
    const expansion = expandImportDependencies(parsed, [], HOUSE);
    parsed.value.forEach((importable, index) => {
        const current = index % 3 !== 0;
        mocks.files.set(
            cachePathForId(HOUSE, importable.type, importableIdentity(importable)),
            JSON.stringify({
                schemaVersion: 2,
                writtenAt: "2026-10-14T00:00:00.000Z",
                writer: "importer",
                importable,
                hash: current ? importableHash(importable) : "stale",
                lists: listHashes(importable),
                itemDependencies: expansion.itemDependencies.snapshotOf(importable),
            })
        );
    });
}

function find(parsed: ImportablesParseResult, type: string, identity: string): Importable {
    const found = parsed.value.find(
        (imp) => imp.type === type && importableIdentity(imp) === identity
    );
    if (found === undefined) throw new Error(`${type} ${identity} is missing`);
    return found;
}

const key = (imp: Importable) => importableKey(imp.type, importableIdentity(imp));

/** Everything an import session reads from the parse, in comparable form. */
function importView(parsed: ImportablesParseResult, selected: Importable, trustMode: boolean) {
    const x = expandImportDependencies(parsed, [selected], HOUSE, {
        trustMode,
        importJsonPath: parsed.gcx.path,
    });
    const items = parsed.value.filter((imp) => imp.type === "ITEM");
    const names = new Set<string>(["Shiny", "§aShiny", "Diamond Sword", "Wand", "§6Wand", "nope"]);
    for (const imp of items) names.add(imp.name);
    const attribution = attributeDiagnostics(parsed);
    const relevant = new Set(attribution.unattributed);
    for (const imp of x.importables) {
        for (const d of attribution.byImportable.get(imp) ?? []) relevant.add(d);
    }
    const trust = buildTrustPlan(HOUSE, x.importables, trustMode, parsed.gcx.path, x.itemDependencies);
    return {
        importables: x.importables.map((imp) => {
            const uses: unknown[] = [];
            visitItemReferences(imp, (use) => {
                uses.push([use.itemName, use.property, x.itemDependencies.sourcePathOf(use)]);
            });
            const plan = trust.importables.get(key(imp));
            return {
                key: key(imp),
                body: JSON.parse(JSON.stringify(imp)) as unknown,
                hash: memoizedImportableHash(imp),
                freshHash: importableHash(imp),
                dependencies: x.itemDependencies.snapshotOf(imp),
                references: collectReferencedImportables(imp),
                uses,
                trust: plan && {
                    sourceHash: plan.sourceHash,
                    cacheHash: plan.cacheHash,
                    breakdown: plan.breakdown,
                    whole: plan.wholeImportableTrusted,
                    lists: Array.from(plan.trustedChildListPaths).sort(),
                },
            };
        }),
        added: x.addedImportables.map(key),
        addedItems: x.addedItems.map((imp) => imp.name),
        cycles: x.itemDependencies.cycles,
        fingerprints: items.map((imp) => [
            imp.name,
            x.itemDependencies.fingerprintOfItem(imp as never),
            x.itemDependencies.clickActionsFingerprint(imp as never),
        ]),
        canonical: Array.from(names, (name) => x.items.canonicalizeObservedName(name)),
        diagnostics: parsed.gcx.diagnostics
            .filter((d) => relevant.has(d))
            .map((d) => `${d.level}: ${d.message}`),
        houseUuid: parsed.importJson.houseUuid,
    };
}

async function sessionView(parsed: ImportablesParseResult, selected: Importable) {
    mocks.scans.length = 0;
    mocks.shellPlans.length = 0;
    const events: unknown[] = [];
    const messages: string[] = [];
    const ctx = {
        sleep: async () => undefined,
        displayMessage: (message: string) => messages.push(message),
    } as unknown as TaskContext;
    await runImportSession(ctx, {
        importables: [selected],
        trustMode: true,
        housingUuid: HOUSE,
        sourcePath: parsed.gcx.path,
        parsed,
        events: { emit: (event) => events.push(JSON.parse(JSON.stringify(event))) },
        conflictHandling: { kind: "proceed" },
    }).catch((error: unknown) => messages.push(`threw: ${(error as Error).message}`));
    return { events, messages, scans: mocks.scans.slice(), shellPlans: mocks.shellPlans.slice() };
}

let projects: Prepared[] = [];

beforeAll(() => {
    vi.stubGlobal("FileLib", {
        exists: (path: string) => mocks.files.has(path),
        read: (path: string) => mocks.files.get(path) ?? null,
        write: (path: string, text: string) => mocks.files.set(path, text),
        delete: (path: string) => mocks.files.delete(path),
    });
    projects = [
        prepare("dense", writeProject(DENSE)),
        prepare("item-cycle", writeProject(ITEM_CYCLE)),
    ];
    for (const name of readdirSync(FIXTURES)) {
        if (existsSync(join(FIXTURES, name, "import.json"))) {
            projects.push(prepare(name, join(FIXTURES, name)));
        }
    }
    for (const project of projects) seedHouseCache(project.full);
});

afterAll(() => {
    vi.unstubAllGlobals();
});

beforeEach(() => {
    mocks.scans.length = 0;
});

describe("project publication", () => {
    it("restores the whole project elsewhere exactly as parsed", () => {
        const dense = projects[0];
        const source = parseImportablesResult(
            new SourceMap(new NodeFileLoader()),
            join(temp[0], "import.json")
        );
        const moved = (value: unknown): unknown =>
            JSON.parse(JSON.stringify(value).split(temp[0]).join(dense.root));
        expect(JSON.parse(JSON.stringify(dense.full.value))).toEqual(moved(source.value));
        expect(dense.full.diagnostics.map((d) => d.message)).toEqual(source.diagnostics.map((d) => d.message));
        expect(dense.full.importJson.houseUuid).toBe(HOUSE);
        expect(dense.full.importJson.dangerouslyDeleteEverythingNotInThisFile).toBe(true);
        expect(JSON.parse(JSON.stringify(dense.full.importJson.fileTree))).toEqual(moved(source.importJson.fileTree));
        // Same sources and parser, same key, wherever they were parsed.
        expect(prepare("again", dense.root).manifest.key).toBe(dense.manifest.key);
    });

    it("gives every import the same expansion, hashes, trust and item resolution as the whole project", () => {
        let compared = 0;
        let expanded = 0;
        let cycles = 0;
        for (const project of projects) {
            for (const entry of project.manifest.importables) {
                const selected = restoreProjectPublication(
                    project.manifest,
                    project.root,
                    (i) => project.bodies[i],
                    [{ type: entry.type, identity: entry.identity }]
                );
                expect(selected.importJson.dangerouslyDeleteEverythingNotInThisFile).toBe(false);
                for (const trustMode of [false, true]) {
                    const view = importView(selected, find(selected, entry.type, entry.identity), trustMode);
                    expect(view, `${project.name} ${entry.type} ${entry.identity}`).toEqual(
                        importView(project.full, find(project.full, entry.type, entry.identity), trustMode)
                    );
                    if (view.importables.length > 1) expanded++;
                    if (view.cycles.length > 0) cycles++;
                }
                compared++;
            }
        }
        expect(compared).toBeGreaterThan(40);
        expect(expanded).toBeGreaterThan(5);
        expect(cycles).toBeGreaterThan(0);
        const dense = projects[0];
        const a = restoreProjectPublication(dense.manifest, dense.root, (i) => dense.bodies[i], [
            { type: "FUNCTION", identity: "A" },
        ]);
        // A and its cycle partner B: only A's body loads; B stays a name.
        expect(a.value.filter((imp) => imp.type === "FUNCTION").map((imp) => imp.name)).toEqual(["A"]);
        expect(a.value.filter((imp) => imp.type === "ITEM")).toHaveLength(6);
    });

    it("runs an import session identically up to the first house read", async () => {
        let reads = 0;
        let refusals = 0;
        for (const project of projects) {
            for (const entry of project.manifest.importables) {
                const selected = restoreProjectPublication(
                    project.manifest,
                    project.root,
                    (i) => project.bodies[i],
                    [{ type: entry.type, identity: entry.identity }]
                );
                const session = await sessionView(selected, find(selected, entry.type, entry.identity));
                expect(session, `${project.name} ${entry.type} ${entry.identity}`).toEqual(
                    await sessionView(project.full, find(project.full, entry.type, entry.identity))
                );
                if (session.scans.length > 0) reads++;
                if (session.messages.some((m) => m.includes("Item click actions form a cycle"))) refusals++;
            }
        }
        expect(reads).toBeGreaterThan(5);
        expect(refusals).toBeGreaterThan(0);
    });

    it("serves a selected restore to HTSW's commands without saving it as the project", async () => {
        const dense = projects[0];
        const entry = installProjectPublication(dense.manifest, dense.root, (i) => dense.bodies[i], [
            { type: "FUNCTION", identity: "B" },
        ]);
        const path = join(dense.root, "import.json");
        expect(getParseAt(path)).toBe(entry);
        expect(await parseImportJsonCurrent(path)).toBe(entry);
        expect(entry.parsed?.value.map(key)).toContain("FUNCTION:B");
        expect(entry.parsed?.value.map(key)).not.toContain("FUNCTION:A");
        expect(loadSnapshot(entry.canonicalPath)).toBeNull();
        // Files left out still guard freshness: editing any of them makes HTSW
        // parse the whole project again.
        const unselected = join(dense.root, "fn/a.htsl");
        expect(entry.fingerprint[unselected]).toBe(Math.floor(statSync(unselected).mtimeMs));
        expect(Object.keys(entry.fingerprint)).toHaveLength(Object.keys(dense.manifest.sources).length);
    });
});
