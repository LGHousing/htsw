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
});
