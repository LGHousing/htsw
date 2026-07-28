import { describe, expect, it } from "vitest";
import type { Importable, ImportableFunction, ImportableRegion } from "htsw/types";

import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type { HouseLock } from "../src/importCache/houseLock";
import {
    evaluateDiffReport,
    formatDiffProgress,
    formatDiffReport,
} from "../src/slashCommands/diffReport";
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
        ).toMatchObject({ clean: 1, conflicts: [], unknown: 0 });
        expect(
            evaluateDiffReport(
                "house",
                [source],
                liveMap(source),
                lockFor("Debug", baseline)
            )
        ).toMatchObject({ clean: 1, conflicts: [], unknown: 0 });
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
        ).toMatchObject({ clean: 0, conflicts: [], unknown: 1 });
        expect(
            evaluateDiffReport("house", [source], liveMap(source), null)
        ).toMatchObject({
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

        expect(evaluateDiffReport("house", [source], liveMap(live), lock)).toMatchObject({
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

    it("reports clean lists that the import will modify as pending", () => {
        const baseline = [message("live")];
        const report = evaluateDiffReport(
            "house",
            [func("Debug", [message("source")])],
            liveMap(func("Debug", baseline)),
            lockFor("Debug", baseline)
        );

        expect(report.pendingChanges).toMatchObject([
            {
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
                sourceText: 'chat "source"\n',
                liveText: 'chat "live"\n',
            },
        ]);
        const lines = formatDiffReport(report, "/project/import.json");
        expect(lines[0]).toBe(
            "[htsw] Diff complete: 1 clean, 0 conflicts, 0 unknown · /project/import.json"
        );
        expect(lines[1]).toBe(
            "[htsw] Pending changes: 1 list will be modified — see report"
        );
        expect(formatDiffProgress(report)).toBe(
            "0 unchanged / 1 pending / 0 conflicts / 0 unknown / 0 rollback warnings"
        );
        expect(
            evaluateDiffReport(
                "house",
                [func("Debug", baseline)],
                liveMap(func("Debug", baseline)),
                lockFor("Debug", baseline)
            ).pendingChanges
        ).toEqual([]);
    });

    it("detects a source hash that predates the live hash in the journal", () => {
        const older = [message("older")];
        const newer = [message("newer")];
        const lock = lockFor("Debug", newer);
        lock.contentHashJournalVersion = 1;
        lock.importables["FUNCTION:Debug"].listContentHashJournal = {
            actions: [
                {
                    hash: actionListContentHashFromActions(older),
                    recordedAt: "2026-07-20T00:00:00.000Z",
                },
                {
                    hash: actionListContentHashFromActions(newer),
                    recordedAt: "2026-07-27T00:00:00.000Z",
                },
            ],
        };

        const report = evaluateDiffReport(
            "house",
            [func("Debug", older)],
            liveMap(func("Debug", newer)),
            lock
        );
        expect(report.pendingChanges?.[0].revertsTo).toBe("2026-07-20T00:00:00.000Z");
        expect(report.revertCount).toBe(1);
        expect(formatDiffReport(report, "/project/import.json")).toContain(
            "[htsw] Warning: 1 list would revert to an older recorded state — see report."
        );
        expect(formatDiffProgress(report)).toContain("1 rollback warning");

        expect(
            evaluateDiffReport(
                "house",
                [func("Debug", [message("brand new")])],
                liveMap(func("Debug", newer)),
                lock
            ).revertCount
        ).toBe(0);
    });
});
