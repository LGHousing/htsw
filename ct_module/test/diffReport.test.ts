import { describe, expect, it } from "vitest";
import type { Importable, ImportableFunction, ImportableRegion } from "htsw/types";

import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type { HouseLock } from "../src/importCache/houseLock";
import { evaluateDiffReport, formatDiffReport } from "../src/slashCommands/diffReport";
import { changeVar, message, playSound } from "./utils";

function func(name: string, actions: ImportableFunction["actions"]): ImportableFunction {
    return { type: "FUNCTION", name, actions };
}

function liveMap(...importables: Importable[]): Map<string, Importable> {
    return new Map(
        importables.map((importable) => [
            `${importable.type}:${
                importable.type === "EVENT"
                    ? importable.event
                    : importable.type === "NPC"
                      ? `${importable.pos.x},${importable.pos.y},${importable.pos.z}`
                      : importable.name
            }`,
            importable,
        ])
    );
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
            evaluateDiffReport(
                "house",
                [source],
                liveMap(func("Debug", baseline)),
                lockFor("Debug", baseline)
            )
        ).toEqual({ clean: 1, conflicts: [], unknown: 0 });
        expect(
            evaluateDiffReport(
                "house",
                [source],
                liveMap(source),
                lockFor("Debug", baseline)
            )
        ).toEqual({ clean: 1, conflicts: [], unknown: 0 });
    });

    it("classifies live changes from both baseline and source as conflicts", () => {
        const source = func("Debug", [message("source")]);
        const report = evaluateDiffReport(
            "house",
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
                    sourceText: 'chat "source"\n',
                    liveText: 'chat "live"\n',
                },
            ],
            unknown: 0,
        });
    });

    it("keeps only missing live reads unknown and compares missing baselines to source", () => {
        const source = func("Debug", [message("source")]);

        expect(
            evaluateDiffReport("house", [source], new Map(), lockFor("Debug", []))
        ).toEqual({ clean: 0, conflicts: [], unknown: 1 });
        expect(evaluateDiffReport("house", [source], liveMap(source), null)).toEqual({
            clean: 1,
            conflicts: [],
            unknown: 0,
        });
        expect(
            evaluateDiffReport(
                "house",
                [source],
                liveMap(func("Debug", [message("live")])),
                null
            )
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

        expect(evaluateDiffReport("house", [source], liveMap(live), lock)).toEqual({
            clean: 0,
            conflicts: [],
            unknown: 1,
        });
    });

    it("falls back to v1 scan hashes when content hashes are absent", () => {
        const source = func("Debug", [playSound()]);
        const report = evaluateDiffReport(
            "house",
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
                            sourceText: 'chat "source"\n',
                            liveText: 'chat "live"\n',
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
            "[htsw] Diff details: ./htsw/projects/shop/htsw-diff/latest.diff",
        ]);
    });
});
