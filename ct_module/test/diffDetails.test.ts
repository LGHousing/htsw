import { describe, expect, it } from "vitest";
import type { Action } from "htsw/types";

import {
    formatDiffDetailsFile,
    printerDiagnosticsForDiff,
} from "../src/housingSync/actions/diffDetails";

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
                    pending: [
                        {
                            type: "FUNCTION",
                            identity: "Pending",
                            basePath: "actions",
                            canonicalDifferences: [
                                {
                                    path: "action 1 (message) · message",
                                    live: '"live pending"',
                                    source: '"source pending"',
                                },
                            ],
                            printerDiagnostics: [],
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
                "# pending changes: 1\n" +
                "# unknown: 1\n" +
                "# Field differences compare the labeled action-list snapshots.\n" +
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
                '+  "a b"\n' +
                "\n" +
                "# PENDING CHANGES\n" +
                "\n" +
                '# FUNCTION "Pending" · actions\n' +
                "--- source/actions\n" +
                "+++ live/actions\n" +
                " action 1 (message) · message\n" +
                '-  "source pending"\n' +
                '+  "live pending"\n'
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
                pending: [],
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

    it("includes complete source and live HTSL for agent review", () => {
        const details = formatDiffDetailsFile(
            {
                clean: 0,
                conflicts: [
                    {
                        type: "FUNCTION",
                        identity: "Debug",
                        basePath: "actions",
                        canonicalDifferences: [
                            {
                                path: "action 1 (message) · message",
                                source: '"source"',
                                live: '"live"',
                            },
                        ],
                        printerDiagnostics: [],
                        baselineKnown: true,
                        baselineActions: [
                            { type: "MESSAGE", message: "last import" },
                        ],
                        housingChangesSinceBaseline: [
                            {
                                path: "action 1 (message) · message",
                                source: '"last import"',
                                live: '"live"',
                            },
                        ],
                        projectChangesSinceBaseline: [
                            {
                                path: "action 1 (message) · message",
                                source: '"last import"',
                                live: '"source"',
                            },
                        ],
                        sourceActions: [{ type: "MESSAGE", message: "source" }],
                        liveActions: [{ type: "MESSAGE", message: "live" }],
                    },
                ],
                pending: [],
                unknown: 0,
            },
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );

        expect(details).toContain(
            "# HOUSING CHANGES SINCE LAST IMPORT\n" +
                "--- last-import/actions\n+++ live/actions\n"
        );
        expect(details).toContain(
            "# COMPLETE LAST IMPORT HTSL\nchat \"last import\"\n\n" +
                "# COMPLETE SOURCE HTSL\nchat \"source\"\n\n" +
                "# COMPLETE LIVE HTSL\nchat \"live\""
        );
    });
});
