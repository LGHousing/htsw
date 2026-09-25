import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeNode = { path: string; includes: FakeNode[] };
type FakeEntry = {
    canonicalPath: string;
    parsed: {
        importJson: {
            dangerouslyDeleteEverythingNotInThisFile: boolean;
            fileTree: FakeNode | null;
        };
    } | null;
};

const parses = vi.hoisted(() => ({ entries: [] as FakeEntry[] }));

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
    forEachCachedParse: (visit: (entry: FakeEntry) => void) => parses.entries.forEach(visit),
    getParseCacheRevision: () => 0,
}));

import {
    addToQueue,
    clearQueue,
    getQueue,
    insertQueueRowsAfter,
    makeBulkQueueRow,
    makeImportableQueueRow,
    type QueueRow,
} from "../src/gui/right-panel/import-tab/queue";

const project = "/projects/house/import.json";
const child = "/projects/house/shop/import.json";

function projectEntry(armed: boolean): FakeEntry {
    return {
        canonicalPath: project,
        parsed: {
            importJson: {
                dangerouslyDeleteEverythingNotInThisFile: armed,
                fileTree: { path: project, includes: [{ path: child, includes: [] }] },
            },
        },
    };
}

function functionRow(path: string, identity: string): QueueRow {
    return makeImportableQueueRow({
        op: "import",
        house: "house",
        path,
        type: "FUNCTION",
        identity,
    });
}

function wholeProject(path: string, scope = path): QueueRow {
    return makeBulkQueueRow({
        op: "import",
        house: "house",
        path,
        scope: { kind: "file", path: scope },
        filter: "all",
        label: "project",
    });
}

beforeEach(() => {
    parses.entries = [projectEntry(true)];
});
afterEach(clearQueue);

describe("a project that claims its whole house", () => {
    it("queues as a whole project", () => {
        expect(addToQueue(wholeProject(project)).kind).toBe("added");
    });

    it("refuses a single importable of it", () => {
        const result = addToQueue(functionRow(project, "Spawn"));
        expect(result.kind).toBe("refused");
        expect(result.message).toContain("only imports as a whole");
        expect(getQueue()).toEqual([]);
    });

    it("refuses one of its includes, as a scope or as its own project", () => {
        expect(addToQueue(wholeProject(project, child)).kind).toBe("refused");
        expect(addToQueue(wholeProject(child)).kind).toBe("refused");
        expect(addToQueue(functionRow(child, "Shop")).kind).toBe("refused");
    });

    it("still takes the rows its own run adds", () => {
        const head = wholeProject(project);
        addToQueue(head);
        const dependency = {
            ...functionRow(project, "Helper"),
            origin: "dependency" as const,
        };
        expect(insertQueueRowsAfter(head.key, [dependency])).toHaveLength(1);
    });

    it("leaves projects without the key alone", () => {
        parses.entries = [projectEntry(false)];
        expect(addToQueue(functionRow(project, "Spawn")).kind).toBe("added");
        expect(addToQueue(functionRow(child, "Shop")).kind).toBe("added");
    });
});
