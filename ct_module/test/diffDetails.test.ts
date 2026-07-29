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
                " action 1 (message) · message\n" +
                '-  "source"\n' +
                '+  "live"\n' +
                "\n" +
                '# REGION "Spawn" · onEnterActions\n' +
                "# HTSL printer warning (source): serialized source is lossy\n" +
                "--- source/onEnterActions\n" +
                "+++ live/onEnterActions\n" +
                " action 1 (message) · note\n" +
                '-  "a\\nb"\n' +
                '+  "a b"\n'
        );
    });

    it("keeps repeated values attached to their canonical difference", () => {
        const source = ["a", "a", "a", "b"];
        const live = ["b", "b", "b", "a"];
        const details = formatDiffDetailsFile(
            {
                clean: 0,
                conflicts: [
                    {
                        type: "FUNCTION",
                        identity: "Repeated values",
                        basePath: "actions",
                        canonicalDifferences: source.map((sourceValue, index) => ({
                            path: `action ${index + 1} (message) · message`,
                            source: `"${sourceValue}"`,
                            live: `"${live[index]}"`,
                        })),
                        printerDiagnostics: [],
                    },
                ],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );

        for (let index = 0; index < source.length; index++) {
            expect(details).toContain(
                ` action ${index + 1} (message) · message\n` +
                    `-  "${source[index]}"\n` +
                    `+  "${live[index]}"`
            );
        }
        expect(details).not.toMatch(/^   "[ab]"$/m);
    });
});
