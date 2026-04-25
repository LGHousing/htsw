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
    it("parseActionsResult parses simple source", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": "chat \"hello\"\n",
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.value.length).toBeGreaterThan(0);
        expect(result.diagnostics.filter((it) => it.level === "error").length).toBe(0);
    });

    it("parseActionsResult accepts placeholder numeric forms", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "stat t20ms = %date.unix.ms%",
                    "stat random = %random.int/1 10%",
                    "stat existing = %var.player/random%",
                    "if and (placeholder \"%player.pos.yaw%\" >= 0.0 0.0) {",
                    "    changeVelocity \"%var.player/car/vx%\" \"-8\" \"%var.player/car/vz%\"",
                    "}",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("parseActionsResult accepts bare placeholders as string arguments", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "chat %player.name%",
                    "actionBar %date.unix.ms%",
                    "title %player.name% %date.unix.ms%",
                    "stat fallback = var missing %date.unix.ms%",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("parseActionsResult accepts underscore numeric separators", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "stat x = 2_001",
                    "stat y += -2_001",
                    "stat z = 2_001.5",
                    "tp custom_coordinates \"~2_001 ~0 ~-2_001 90 0\"",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("parseActionsResult accepts tp custom_coordinates with optional yaw/pitch", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "tp custom_coordinates \"54.5 81 113\"",
                    "tp custom_coordinates \"54.5 81 113 -90\"",
                    "tp custom_coordinates \"54.5 81 113 -90 0\"",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("parseActionsResult rejects tp custom_coordinates with too many components", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "tp custom_coordinates \"54.5 81 113 -90 0 5\"",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        const errors = result.diagnostics.filter((it) => it.level === "error");
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("at most 5 components");
    });

    it("parseImportablesResult parses simple import.json", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/import.json": JSON.stringify({
                    regions: [{ name: "SpawnRegion" }],
                }),
            })
        );

        const result = htsw.parseImportablesResult(sourceMap, "/project/import.json");

        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("REGION");
    });
});
