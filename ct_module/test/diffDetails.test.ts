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

    it("renders pending changes in their own full diff section", () => {
        const output = formatDiffDetailsFile(
            {
                clean: 1,
                conflicts: [],
                pendingChanges: [
                    {
                        type: "FUNCTION",
                        identity: "Debug",
                        basePath: "actions",
                        sourceText: 'chat "source"\n',
                        liveText: 'chat "live"\n',
                        differences: [],
                        moreCount: 0,
                        revertsTo: "2026-07-20T00:00:00.000Z",
                    },
                ],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-28T00:00:00.000Z"
        );

        expect(output).toContain(
            "# PENDING CHANGES (what this import will write)\n\n" +
                '# FUNCTION "Debug" · actions\n' +
                "# ⚠ reverts to recorded state from 2026-07-20T00:00:00.000Z\n" +
                "--- source/actions\n" +
                "+++ live/actions\n"
        );
        expect(
            formatDiffDetailsFile(
                { clean: 1, conflicts: [], pendingChanges: [], unknown: 0 },
                "/project/import.json",
                "2026-07-28T00:00:00.000Z"
            )
        ).not.toContain("# PENDING CHANGES");
    });
});
