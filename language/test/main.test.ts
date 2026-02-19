import { describe, expect, it } from "vitest";
import * as htsw from "../src";

class SimpleFileLoader implements htsw.FileLoader {
    private readonly files: Map<string, string>;

    constructor(files: Record<string, string>) {
        this.files = new Map(Object.entries(files));
    }

    fileExists(path: string): boolean {
        return this.files.has(path);
    }

    readFile(path: string): string {
        const src = this.files.get(path);
        if (src === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return src;
    }

    getParentPath(base: string): string {
        const index = base.lastIndexOf("/");
        return index === -1 ? "" : base.slice(0, index);
    }

    resolvePath(base: string, other: string): string {
        if (other.startsWith("/")) return other;
        if (!base) return other;
        return `${base}/${other}`;
    }
}

describe("Main API", () => {
    it("parseIrActions parses simple source", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": "chat \"hello\"\n",
            })
        );

        const result = htsw.parseIrActions(sourceMap, "/project/test.htsl");

        expect(result.value.length).toBeGreaterThan(0);
        expect(result.diagnostics.filter((it) => it.level === "error").length).toBe(0);
    });

    it("parseIrImportables parses simple import.json", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/import.json": JSON.stringify({
                    regions: [{ name: "SpawnRegion" }],
                }),
            })
        );

        const result = htsw.parseIrImportables(sourceMap, "/project/import.json");

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("REGION");
    });
});
