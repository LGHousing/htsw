import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startImport: vi.fn(),
}));

vi.mock("../src/gui/right-panel/import-tab/taskController", () => ({
    startImport: mocks.startImport,
}));

vi.mock("../src/gui/parsing/parses", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/gui/parsing/parses")>()),
    canonicalPath: (path: string) => path,
}));

vi.mock("../src/project/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/project/paths")>()),
    resolveModuleRelativePath: (path: string) => path,
}));

let commandImport: typeof import("../src/slashCommands/index").commandImport;

beforeAll(async () => {
    const registration: Record<string, unknown> = new Proxy(
        {},
        {
            get: () => () => registration,
        }
    );
    const java: object = new Proxy(function () {}, {
        get: (_target, property) => (property === Symbol.toPrimitive ? () => 0 : java),
        apply: () => java,
        construct: () => java,
    });
    vi.stubGlobal("register", () => registration);
    vi.stubGlobal("java", java);
    commandImport = (await import("../src/slashCommands/index")).commandImport;
});

beforeEach(() => {
    mocks.startImport.mockClear();
    vi.stubGlobal("FileLib", {
        exists: () => true,
    });
});

describe("/htsw import wiring", () => {
    it("forwards --fresh to the GUI import controller", () => {
        commandImport(["--fresh", "import.json"]);

        expect(mocks.startImport).toHaveBeenCalledWith(
            [
                {
                    operation: "import",
                    kind: "importJson",
                    sourcePath: "import.json",
                    label: "import.json",
                },
            ],
            { onConflict: "prompt", fresh: true }
        );
    });
});
