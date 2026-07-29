import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    report: null as unknown as {
        clean: number;
        conflicts: unknown[];
        pending: unknown[];
        unknown: number;
    },
    atomicWriteText: vi.fn<(path: string, content: string) => boolean>(),
    start: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    clear: vi.fn(),
    files: new Set<string>(),
}));

vi.mock("htsw", async (importOriginal) => {
    const actual = await importOriginal<typeof import("htsw")>();
    return {
        ...actual,
        parseImportablesResult: () => ({ value: [], diagnostics: [] }),
    };
});

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path,
}));

vi.mock("../src/project/paths", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/project/paths")>();
    return {
        ...actual,
        resolveModuleRelativePath: (path: string) => path,
        parentDirOf: (path: string) => path.substring(0, path.lastIndexOf("/")),
    };
});

vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => false },
    isTaskCancelled: () => false,
}));

vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: (
        _kind: string,
        task: (ctx: Record<string, never>) => Promise<void>
    ) => Promise.resolve().then(() => task({})),
}));

vi.mock("../src/importCache/housingId", () => ({
    getCurrentHousingUuid: () => Promise.resolve("house"),
}));

vi.mock("../src/importCache/houseLock", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../src/importCache/houseLock")>();
    return {
        ...actual,
        readHouseLock: () => null,
    };
});

vi.mock("../src/gui/right-panel/import-tab/diffProgress", () => ({
    createDiffProgressSession: () => ({
        start: state.start,
        sinkFor: () => undefined,
        complete: state.complete,
        fail: state.fail,
        clear: state.clear,
    }),
}));

vi.mock("../src/utils/filesystem", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/utils/filesystem")>();
    return {
        ...actual,
        atomicWriteText: state.atomicWriteText,
    };
});

vi.mock("../src/slashCommands/diffReport", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("../src/slashCommands/diffReport")>();
    return {
        ...actual,
        evaluateDiffReport: () => state.report,
    };
});

import { commandDiff } from "../src/slashCommands/diff";

function conflict(identity: string) {
    const difference = {
        path: "action 1 (message) · message",
        live: '"live"',
        source: '"source"',
    };
    return {
        type: "FUNCTION" as const,
        identity,
        basePath: "actions",
        differences: [difference],
        moreCount: 0,
        canonicalDifferences: [difference],
        printerDiagnostics: [],
    };
}

async function runCommand(): Promise<string[]> {
    commandDiff(["/project/import.json"]);
    await vi.waitFor(() => expect(state.complete).toHaveBeenCalled());
    return state.complete.mock.calls.length === 0
        ? []
        : (ChatLib.chat as ReturnType<typeof vi.fn>).mock.calls.map(
              ([line]) => line as string
          );
}

describe("/htsw diff report persistence", () => {
    beforeEach(() => {
        state.report = {
            clean: 0,
            conflicts: [conflict("One"), conflict("Two")],
            pending: [],
            unknown: 0,
        };
        state.atomicWriteText.mockReset();
        state.atomicWriteText.mockReturnValue(true);
        state.start.mockReset();
        state.complete.mockReset();
        state.fail.mockReset();
        state.clear.mockReset();
        state.files.clear();
        vi.stubGlobal("FileLib", {
            exists: (path: string) =>
                path === "/project/import.json" || state.files.has(path),
            read: () => null,
            write: () => undefined,
            delete: (path: string) => state.files.delete(path),
        });
        vi.stubGlobal("ChatLib", {
            chat: vi.fn(),
        });
    });

    it("writes and links a report containing every conflict", async () => {
        const chat = await runCommand();

        expect(state.atomicWriteText).toHaveBeenCalledTimes(1);
        expect(state.atomicWriteText).toHaveBeenCalledWith(
            "/project/htsw-diff/latest.diff",
            expect.stringContaining('# FUNCTION "One" · actions')
        );
        expect(state.atomicWriteText.mock.calls[0][1]).toContain(
            '# FUNCTION "Two" · actions'
        );
        expect(chat).toContain(
            "[htsw] Diff details: /project/htsw-diff/latest.diff"
        );
        expect(state.fail).not.toHaveBeenCalled();
    });

    it("delivers the conflict result before reporting a write failure", async () => {
        state.atomicWriteText.mockReturnValue(false);

        const chat = await runCommand();

        expect(chat[0]).toBe(
            "[htsw] Diff complete: 0 clean, 2 conflicts, 0 unknown · /project/import.json"
        );
        expect(
            (ChatLib.chat as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
        ).toBeLessThan(state.atomicWriteText.mock.invocationCallOrder[0]);
        expect(chat[chat.length - 1]).toBe(
            "[htsw] Diff details not written: could not write diff details '/project/htsw-diff/latest.diff'"
        );
        expect(chat.some((line) => line.startsWith("[htsw] Diff failed:"))).toBe(
            false
        );
        expect(state.complete).toHaveBeenCalledWith(
            "0 clean / 2 conflicts / 0 unknown"
        );
        expect(state.fail).not.toHaveBeenCalled();
    });

    it("removes a stale latest report when writing its replacement fails", async () => {
        state.files.add("/project/htsw-diff/latest.diff");
        state.atomicWriteText.mockReturnValue(false);

        await runCommand();

        expect(state.files.has("/project/htsw-diff/latest.diff")).toBe(false);
        expect(state.complete).toHaveBeenCalledWith(
            "0 clean / 2 conflicts / 0 unknown"
        );
        expect(state.fail).not.toHaveBeenCalled();
    });

    it("replaces a conflict report with a clean-run report", async () => {
        await runCommand();
        state.report = { clean: 1, conflicts: [], pending: [], unknown: 0 };

        commandDiff(["/project/import.json"]);
        await vi.waitFor(() => expect(state.complete).toHaveBeenCalledTimes(2));

        expect(state.atomicWriteText).toHaveBeenCalledTimes(2);
        expect(state.atomicWriteText.mock.calls[1][0]).toBe(
            "/project/htsw-diff/latest.diff"
        );
        expect(state.atomicWriteText.mock.calls[1][1]).toContain("# conflicts: 0");
        expect(state.atomicWriteText.mock.calls[1][1]).not.toContain(
            '# FUNCTION "One"'
        );
    });
});
