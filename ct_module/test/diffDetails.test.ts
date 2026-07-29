import { describe, expect, it } from "vitest";
import type { Action } from "htsw/types";

import {
    formatDiffDetailsFile,
    printerDiagnosticsForDiff,
} from "../src/slashCommands/diffDetails";

describe("diff details", () => {
    it("surfaces diagnostics from lossy HTSL printing", () => {
        const actions: Action[] = [{ type: "REMOVE_ITEM" }];

        expect(printerDiagnosticsForDiff("source", actions)).toEqual([
            {
                side: "source",
                level: "warning",
                message:
                    "REMOVE_ITEM was emitted with a placeholder item name; HTSL has no syntax for inline item NBT.",
            },
        ]);
    });

    it("assembles canonical details for multiple conflicts", () => {
        expect(
            formatDiffDetailsFile(
                {
                    clean: 2,
                    conflicts: [
                        {
                            type: "FUNCTION",
                            identity: "Debug",
                            basePath: "actions",
                            canonicalDifferences: [
                                {
                                    path: "action 1 (message) · message",
                                    live: '"live"',
                                    source: '"source"',
                                },
                            ],
                            printerDiagnostics: [],
                        },
                        {
                            type: "REGION",
                            identity: "Spawn",
                            basePath: "onEnterActions",
                            canonicalDifferences: [
                                {
                                    path: "action 1 (message) · note",
                                    live: '"a b"',
                                    source: '"a\\nb"',
                                },
                            ],
                            printerDiagnostics: [
                                {
                                    side: "source",
                                    level: "warning",
                                    message: "serialized source is lossy",
                                },
                            ],
                        },
                    ],
                    unknown: 1,
                },
                "/project/import.json",
                "2026-07-27T12:00:00.000Z"
            )
        ).toBe(
            "# HTSW diff details\n" +
                "# timestamp: 2026-07-27T12:00:00.000Z\n" +
                "# manifest: /project/import.json\n" +
                "# clean: 2\n" +
                "# conflicts: 2\n" +
                "# unknown: 1\n" +
                "# Values use the canonical field comparison that determined the verdict.\n" +
                "\n" +
                '# FUNCTION "Debug" · actions\n' +
                "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1,2 +1,2 @@\n" +
                " action 1 (message) · message\n" +
                '-  "source"\n' +
                '+  "live"\n' +
                "\n" +
                '# REGION "Spawn" · onEnterActions\n' +
                "# HTSL printer warning (source): serialized source is lossy\n" +
                "--- source/onEnterActions\n" +
                "+++ live/onEnterActions\n" +
                "@@ -1,2 +1,2 @@\n" +
                " action 1 (message) · note\n" +
                '-  "a\\nb"\n' +
                '+  "a b"\n'
        );
    });

    it("adds a unified canonical SNBT section for item differences", () => {
        const output = formatDiffDetailsFile(
            {
                clean: 0,
                conflicts: [
                    {
                        type: "FUNCTION",
                        identity: "Items",
                        basePath: "actions",
                        canonicalDifferences: [
                            {
                                path: "action 1 (give item) · itemName",
                                live: "<item>",
                                source: "<item>",
                            },
                        ],
                        itemDifferences: [
                            {
                                path: "action 1 (give item) · itemName",
                                sourceSnbt: '{\n  id: "minecraft:cookie"\n}',
                                liveSnbt: '{\n  id: "minecraft:apple"\n}',
                            },
                        ],
                        printerDiagnostics: [],
                    },
                ],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );

        expect(output).toContain(
            "# item · action 1 (give item) · itemName\n" +
                "--- source/actions/action 1 (give item) · itemName.snbt\n" +
                "+++ live/actions/action 1 (give item) · itemName.snbt\n"
        );
        expect(output).toContain('-  id: "minecraft:cookie"');
        expect(output).toContain('+  id: "minecraft:apple"');
    });

    it("bounds one rendered item section by its combined output", () => {
        const sourceSnbt = Array.from(
            { length: 300 },
            (_, index) => `source_${index}: ${"s".repeat(80)}`
        ).join("\n");
        const liveSnbt = Array.from(
            { length: 300 },
            (_, index) => `live_${index}: ${"l".repeat(80)}`
        ).join("\n");
        const output = formatDiffDetailsFile(
            {
                clean: 0,
                conflicts: [
                    {
                        type: "FUNCTION",
                        identity: "Items",
                        basePath: "actions",
                        canonicalDifferences: [],
                        itemDifferences: [
                            {
                                path: "action 1 · itemName",
                                sourceSnbt,
                                liveSnbt,
                            },
                        ],
                        printerDiagnostics: [],
                    },
                ],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );
        const itemOutput = output
            .substring(output.indexOf("# item"))
            .replace(/\n+$/, "");

        expect(itemOutput.split("\n").length).toBeLessThanOrEqual(120);
        expect(itemOutput.length).toBeLessThanOrEqual(12000);
        expect(itemOutput).toContain("# HTSW diff body omitted:");
    });

    it("caps the total item section count and budget", () => {
        const itemDifferences = Array.from({ length: 8 }, (_, index) => ({
            path: `action ${index + 1} · itemName`,
            sourceSnbt: `{id:"minecraft:stone",source:${index}}`,
            liveSnbt: `{id:"minecraft:dirt",live:${index}}`,
        }));
        const output = formatDiffDetailsFile(
            {
                clean: 0,
                conflicts: [
                    {
                        type: "FUNCTION",
                        identity: "Items",
                        basePath: "actions",
                        canonicalDifferences: [],
                        itemDifferences,
                        printerDiagnostics: [],
                    },
                ],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );
        const itemOutput = output
            .substring(output.indexOf("# item"))
            .replace(/\n+$/, "");

        expect(output.match(/^# item ·/gm)).toHaveLength(5);
        expect(itemOutput.split("\n").length).toBeLessThanOrEqual(120);
        expect(itemOutput.length).toBeLessThanOrEqual(12000);
    });
});
