import type { ImportablesParseResult } from "htsw";
import type { Importable, ImportableFunction, ImportableTeam } from "htsw/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expandImportDependencies } from "../src/importables/import/dependencyExpansion";
import type { ImportableCacheEntry } from "../src/importCache/cache";
import { importableHash, listHashes } from "../src/importCache/hash";

function parsed(importables: Importable[]): ImportablesParseResult {
    return {
        value: importables,
        gcx: undefined,
    } as unknown as ImportablesParseResult;
}

function cacheEntry(importable: Importable): ImportableCacheEntry {
    return {
        schemaVersion: 2,
        writtenAt: "2026-07-29T00:00:00.000Z",
        writer: "importer",
        importable,
        hash: importableHash(importable),
        lists: listHashes(importable),
    };
}

describe("trusted dependency expansion", () => {
    const team: ImportableTeam = { type: "TEAM", name: "Runners" };
    const owner: ImportableFunction = {
        type: "FUNCTION",
        name: "Start",
        actions: [{ type: "SET_TEAM", team: team.name }],
    };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("does not add a matching referenced team when trust is enabled", () => {
        const uuid = "trusted-dependency-expansion";
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/team/Runners.knowledge.json`]: JSON.stringify(
                cacheEntry(team)
            ),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        const expansion = expandImportDependencies(parsed([team, owner]), [owner], uuid, {
            trustMode: true,
        });

        expect(expansion.importables).toEqual([owner]);
        expect(expansion.addedImportables).toEqual([]);
    });

    it("still adds the referenced team when trust is disabled", () => {
        const expansion = expandImportDependencies(
            parsed([team, owner]),
            [owner],
            "untrusted-dependency-expansion"
        );

        expect(expansion.importables).toEqual([team, owner]);
        expect(expansion.addedImportables).toEqual([team]);
    });
});
