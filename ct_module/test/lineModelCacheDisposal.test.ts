import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/gui/lib/java", () => ({
    getMtimeMs: () => 1,
    pathExists: () => true,
}));

vi.mock("../src/utils/fileLoaders", () => ({
    FileSystemFileLoader: class {
        readFile(): string {
            return "{}";
        }

        getParentPath(path: string): string {
            return path;
        }

        resolvePath(base: string, other: string): string {
            return `${base}/${other}`;
        }
    },
}));

vi.mock("../src/gui/code-view/htslParse", () => ({
    actionLineRange: () => null,
    actionsToLines: () => [],
    parseHtslFile: () => ({
        mtime: 1,
        actions: [],
        parseError: "parse failed",
        spans: null,
        file: null,
    }),
}));

vi.mock("../src/gui/parsing/selectedParse", () => ({
    getSelectedParsedResult: () => null,
}));

vi.mock("../src/gui/parsing/parses", () => ({
    getParseAt: () => null,
    onParseCacheEntryChanged: () => () => undefined,
}));

vi.mock("../src/gui/lib/pathDisplay", () => ({
    shortPath: (path: string) => path,
}));

type LineModelModule = typeof import("../src/gui/code-view/lineModel");

let lineModel: LineModelModule;

beforeAll(async () => {
    lineModel = await import("../src/gui/code-view/lineModel");
});

function populate(root: string): void {
    lineModel.linesForFile(root);
    lineModel.linesForFile(`${root}/nested/file.json`);
    lineModel.linesForFile(`${root}/nested/file.snbt`);
    lineModel.linesForFile(`${root}/nested/file.htsl`);
}

describe("disposeLineModelCachesUnder", () => {
    it("clears exact and descendant entries without clearing a sibling prefix", () => {
        populate("/project/a");
        populate("/project/ab");
        expect(lineModel.lineModelCacheSizes()).toEqual({
            plain: 6,
            htsl: 2,
            json: 2,
            snbt: 2,
            htslRaw: 2,
        });

        lineModel.disposeLineModelCachesUnder("/project/a");

        expect(lineModel.lineModelCacheSizes()).toEqual({
            plain: 3,
            htsl: 1,
            json: 1,
            snbt: 1,
            htslRaw: 1,
        });
    });
});
