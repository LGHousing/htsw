import { describe, expect, it } from "vitest";
import type {
    Action,
    Importable,
    ImportableFunction,
    ImportableRegion,
} from "htsw/types";

import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type { HouseLock } from "../src/importCache/houseLock";
import { formatDiffDetailsFile } from "../src/slashCommands/diffDetails";
import {
    evaluateDiffReport,
    formatDiffReport,
    matchDiffActionLists,
    type LiveDiffImportable,
} from "../src/slashCommands/diffReport";
import { changeVar, message, playSound } from "./utils";

function func(name: string, actions: ImportableFunction["actions"]): ImportableFunction {
    return { type: "FUNCTION", name, actions };
}

function liveMap(...importables: Importable[]): Map<string, LiveDiffImportable> {
    return new Map(
        importables.map((importable) => [
            `${importable.type}:${
                importable.type === "EVENT"
                    ? importable.event
                    : importable.type === "NPC"
                      ? `${importable.pos.x},${importable.pos.y},${importable.pos.z}`
                      : importable.name
            }`,
            { importable, itemContent: () => undefined },
        ])
    );
}

function evaluate(
    source: readonly Importable[],
    live: ReadonlyMap<string, LiveDiffImportable>,
    lock: HouseLock | null
) {
    return evaluateDiffReport("house", matchDiffActionLists(source, live), lock);
}

function lockFor(
    name: string,
    baseline: ImportableFunction["actions"],
    includeContentHash = true
): HouseLock {
    return {
        schemaVersion: 1,
        houseUuid: "house",
        scanHashVersion: 1,
        ...(includeContentHash ? { contentHashVersion: 1 } : {}),
        importables: {
            [`FUNCTION:${name}`]: {
                type: "FUNCTION",
                identity: name,
                hash: "baseline",
                listScanHashes: {
                    actions: actionListScanHashFromActions(baseline ?? []),
                },
                ...(includeContentHash
                    ? {
                          listContentHashes: {
                              actions: actionListContentHashFromActions(baseline ?? []),
                          },
                      }
                    : {}),
            },
        },
    };
}

describe("diff report", () => {
    it("classifies unchanged and already-applied lists as clean", () => {
        const baseline = [message("baseline")];
        const source = func("Debug", [message("source")]);

        expect(
            evaluate(
                [source],
                liveMap(func("Debug", baseline)),
                lockFor("Debug", baseline)
            )
        ).toEqual({ clean: 1, conflicts: [], unknown: 0 });
        expect(evaluate([source], liveMap(source), lockFor("Debug", baseline))).toEqual({
            clean: 1,
            conflicts: [],
            unknown: 0,
        });
    });

    it("classifies live changes from both baseline and source as conflicts", () => {
        const source = func("Debug", [message("source")]);
        const report = evaluate(
            [source],
            liveMap(func("Debug", [message("live")])),
            lockFor("Debug", [message("baseline")])
        );

        expect(report).toMatchObject({
            clean: 0,
            conflicts: [
                {
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                    differences: [
                        {
                            path: "action 1 (message) · message",
                            live: '"live"',
                            source: '"source"',
                        },
                    ],
                    moreCount: 0,
                    canonicalDifferences: [
                        {
                            path: "action 1 (message) · message",
                            live: '"live"',
                            source: '"source"',
                        },
                    ],
                    printerDiagnostics: [],
                },
            ],
            unknown: 0,
        });
    });

    it("keeps only missing live reads unknown and compares missing baselines to source", () => {
        const source = func("Debug", [message("source")]);

        expect(evaluate([source], new Map(), lockFor("Debug", []))).toEqual({
            clean: 0,
            conflicts: [],
            unknown: 1,
        });
        expect(evaluate([source], liveMap(source), null)).toEqual({
            clean: 1,
            conflicts: [],
            unknown: 0,
        });
        expect(
            evaluate([source], liveMap(func("Debug", [message("live")])), null)
        ).toMatchObject({
            clean: 0,
            conflicts: [{ type: "FUNCTION", identity: "Debug", basePath: "actions" }],
            unknown: 0,
        });
    });

    it("classifies a missing live action-list counterpart as unknown", () => {
        const baseline = [message("baseline")];
        const source: ImportableRegion = {
            type: "REGION",
            name: "Spawn",
            bounds: {
                from: { x: 0, y: 0, z: 0 },
                to: { x: 1, y: 1, z: 1 },
            },
            onEnterActions: [message("source")],
        };
        const live: ImportableRegion = {
            type: "REGION",
            name: "Spawn",
            bounds: source.bounds,
            onExitActions: [message("live exit")],
        };
        const lock: HouseLock = {
            schemaVersion: 1,
            houseUuid: "house",
            scanHashVersion: 1,
            contentHashVersion: 1,
            importables: {
                "REGION:Spawn": {
                    type: "REGION",
                    identity: "Spawn",
                    hash: "baseline",
                    listScanHashes: {
                        onEnterActions: actionListScanHashFromActions(baseline),
                    },
                    listContentHashes: {
                        onEnterActions: actionListContentHashFromActions(baseline),
                    },
                },
            },
        };

        expect(evaluate([source], liveMap(live), lock)).toEqual({
            clean: 0,
            conflicts: [],
            unknown: 1,
        });
    });

    it("falls back to v1 scan hashes when content hashes are absent", () => {
        const source = func("Debug", [playSound()]);
        const report = evaluate(
            [source],
            liveMap(func("Debug", [changeVar()])),
            lockFor("Debug", [message("baseline")], false)
        );

        expect(report.conflicts).toMatchObject([
            {
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
                differences: [
                    {
                        path: "action 1 (change var) · type",
                        live: "CHANGE_VAR",
                        source: "PLAY_SOUND",
                    },
                ],
                moreCount: 0,
            },
        ]);
    });

    it("keeps multiline note conflicts actionable in the details file", () => {
        const source = func("Debug", [message("same", { note: "a\nb" })]);
        const report = evaluate(
            [source],
            liveMap(func("Debug", [message("same", { note: "a b" })])),
            lockFor("Debug", [message("same", { note: "baseline" })])
        );

        const details = formatDiffDetailsFile(
            report,
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );

        expect(details).toContain("action 1 (message) · note");
        expect(details).toContain('-  "a\\nb"');
        expect(details).toContain('+  "a b"');
    });

    it("omits default-equivalent fields from canonical details", () => {
        const source = func("Debug", [playSound({ sound: "random.anvil_land" })]);
        const report = evaluate(
            [source],
            liveMap(
                func("Debug", [
                    playSound({
                        sound: "random.orb",
                        volume: 0.7,
                        pitch: 1,
                    }),
                ])
            ),
            lockFor("Debug", [playSound({ sound: "mob.cat.meow" })])
        );

        expect(report.conflicts[0].canonicalDifferences).toEqual([
            {
                path: "action 1 (play sound) · sound",
                live: '{"type":"random.orb"}',
                source: '{"type":"random.anvil_land"}',
            },
        ]);
        expect(
            formatDiffDetailsFile(
                report,
                "/project/import.json",
                "2026-07-27T12:00:00.000Z"
            )
        ).not.toContain("volume");
    });

    it("includes printer diagnostics for a conflicting item action", () => {
        const sourceAction: Action = {
            type: "REMOVE_ITEM",
            note: "source",
        };
        const liveAction: Action = {
            type: "REMOVE_ITEM",
            note: "live",
        };
        const report = evaluate(
            [func("Debug", [sourceAction])],
            liveMap(func("Debug", [liveAction])),
            lockFor("Debug", [{ type: "REMOVE_ITEM", note: "baseline" }])
        );

        const details = formatDiffDetailsFile(
            report,
            "/project/import.json",
            "2026-07-27T12:00:00.000Z"
        );

        expect(details).toContain(
            "# HTSL printer warning (source): REMOVE_ITEM was emitted with a placeholder item name"
        );
        expect(details).toContain(
            "# HTSL printer warning (live): REMOVE_ITEM was emitted with a placeholder item name"
        );
    });

    it("includes the action-list base path in conflict output", () => {
        expect(
            formatDiffReport(
                {
                    clean: 0,
                    conflicts: [
                        {
                            type: "MENU",
                            identity: "Shop",
                            basePath: "slots[3].actions",
                            differences: [
                                {
                                    path: "action 1 (message) · message",
                                    live: '"live"',
                                    source: '"source"',
                                },
                            ],
                            moreCount: 2,
                            canonicalDifferences: [
                                {
                                    path: "action 1 (message) · message",
                                    live: '"live"',
                                    source: '"source"',
                                },
                            ],
                            printerDiagnostics: [],
                        },
                    ],
                    unknown: 0,
                },
                "./htsw/projects/shop/import.json",
                "./htsw/projects/shop/htsw-diff/latest.diff"
            )
        ).toEqual([
            "[htsw] Diff complete: 0 clean, 1 conflicts, 0 unknown · ./htsw/projects/shop/import.json",
            '[htsw] Conflict: MENU "Shop" · slots[3].actions',
            '[htsw]   ≠ action 1 (message) · message: live="live" · source="source"',
            "[htsw]   …and 2 more differences",
            "[htsw] Diff details: ./htsw/projects/shop/htsw-diff/latest.diff",
        ]);
    });
});
