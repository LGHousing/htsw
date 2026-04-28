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

    it("compare-placeholder accepts string placeholders with == ", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "if and (placeholder \"%player.name%\" == \"Notch\") {",
                    "    chat \"hi Notch\"",
                    "}",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("compare-placeholder accepts numeric placeholders with ordering ops", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "if and (placeholder \"%player.health%\" >= 10) {",
                    "    chat \"healthy\"",
                    "}",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
    });

    it("compare-placeholder rejects ordering ops on string placeholders", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "if and (placeholder \"%player.name%\" > \"Notch\") {",
                    "    chat \"hi\"",
                    "}",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        const errors = result.diagnostics.filter((it) => it.level === "error");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((d) =>
            d.message.includes("String placeholders can only be compared with =="),
        )).toBe(true);
    });

    it("compare-placeholder amount surfaces a clearer error for non-numeric strings", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "if and (placeholder \"%date.day%\" >= \"six\") {",
                    "    chat \"hi\"",
                    "}",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        const errors = result.diagnostics.filter((it) => it.level === "error");
        expect(errors.some((d) =>
            d.message.includes("Expected number or numeric placeholder"),
        )).toBe(true);
        // The old misleading message must no longer fire on this input.
        expect(errors.every((d) => d.message !== "Expected placeholder")).toBe(true);
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

    it("parseActionsResult preserves decimal value type without precision padding", () => {
        const sourceMap = new htsw.SourceMap(
            new SimpleFileLoader({
                "/project/test.htsl": [
                    "stat whole = 360",
                    "stat decimal = 360.00000000000000000000",
                    "stat small = -0.01700000000000000122",
                    "",
                ].join("\n"),
            })
        );

        const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

        expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
        expect(result.value).toMatchObject([
            { type: "CHANGE_VAR", key: "whole", value: "360" },
            { type: "CHANGE_VAR", key: "decimal", value: "360.0" },
            { type: "CHANGE_VAR", key: "small", value: "-0.017" },
        ]);
    });

    it("parseActionsResult canonicalizes decimals even when Number.toString bloats (Rhino guard)", () => {
        // Vitest runs on V8, where `Number.prototype.toString()` emits the
        // shortest round-trip form ("5508000"). The Rhino engine that
        // ChatTriggers uses emits 20-digit fixed precision instead
        // ("5508000.00000000000000000000"). The parser must canonicalize
        // identically on both engines, so it can't depend on toString.
        // We simulate the Rhino quirk by replacing toString with toFixed(20)
        // and assert the canonical output is unchanged.
        const originalToString = Number.prototype.toString;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (Number.prototype as any).toString = function (this: number) {
                // Pass through 0 and non-finite values so unrelated code
                // (e.g. error formatting) doesn't break under the mock.
                if (this === 0 || !Number.isFinite(this)) {
                    return originalToString.call(this);
                }
                return this.toFixed(20);
            };

            const sourceMap = new htsw.SourceMap(
                new SimpleFileLoader({
                    "/project/test.htsl": [
                        "stat a = 5508000.0",
                        "stat b = -0.017",
                        "stat c = 360.00000000000000000000",
                        "stat d = -0.01700000000000000122",
                        "stat e = -0.0",
                        "",
                    ].join("\n"),
                })
            );
            const result = htsw.parseActionsResult(sourceMap, "/project/test.htsl");

            expect(result.diagnostics.filter((it) => it.level === "error")).toEqual([]);
            expect(result.value).toMatchObject([
                { type: "CHANGE_VAR", key: "a", value: "5508000.0" },
                { type: "CHANGE_VAR", key: "b", value: "-0.017" },
                { type: "CHANGE_VAR", key: "c", value: "360.0" },
                { type: "CHANGE_VAR", key: "d", value: "-0.017" },
                { type: "CHANGE_VAR", key: "e", value: "0.0" },
            ]);
        } finally {
            Number.prototype.toString = originalToString;
        }
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
