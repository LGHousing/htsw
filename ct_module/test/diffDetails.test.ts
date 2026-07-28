import { describe, expect, it } from "vitest";
import * as htsw from "htsw";

import {
    formatDiffDetailsFile,
    renderActionsForDiff,
} from "../src/slashCommands/diffDetails";
import { message } from "./utils";

describe("diff details", () => {
    it("reuses the exporter HTSL serializer", () => {
        const actions = [message("source")];

        expect(renderActionsForDiff(actions)).toBe(
            htsw.htsl.printActionsWithDiagnostics(actions).source
        );
    });

    it("assembles a canonical action-list diff report", () => {
        const sourceText = renderActionsForDiff([message("source")]);
        const liveText = renderActionsForDiff([message("live")]);

        expect(
            formatDiffDetailsFile(
                {
                    clean: 2,
                    conflicts: [
                        {
                            type: "FUNCTION",
                            identity: "Debug",
                            basePath: "actions",
                            sourceText,
                            liveText,
                            differences: [
                                {
                                    path: "action 1 (message) · message",
                                    live: '"live"',
                                    source: '"source"',
                                },
                            ],
                            moreCount: 2,
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
                "# conflicts: 1\n" +
                "# unknown: 1\n" +
                "\n" +
                '# FUNCTION "Debug" · actions\n' +
                '# ≠ action 1 (message) · message: live="live" · source="source"\n' +
                "# …and 2 more differences\n" +
                "--- source/actions\n" +
                "+++ live/actions\n" +
                "@@ -1 +1 @@\n" +
                '-chat "source"\n' +
                '+chat "live"\n'
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
                        sourceText: 'giveItem "mvp_cookies.snbt"\n',
                        liveText: 'giveItem "mvp_cookies"\n',
                        differences: [
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
                        moreCount: 0,
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
                        sourceText: "",
                        liveText: "",
                        differences: [],
                        itemDifferences: [
                            {
                                path: "action 1 · itemName",
                                sourceSnbt,
                                liveSnbt,
                            },
                        ],
                        moreCount: 0,
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
        expect(itemOutput).toContain("# …item diff truncated");
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
                        sourceText: "",
                        liveText: "",
                        differences: [],
                        itemDifferences,
                        moreCount: 3,
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
