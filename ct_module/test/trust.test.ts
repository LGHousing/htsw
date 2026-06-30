import { describe, expect, it } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import type { ImportableCacheEntry } from "../src/importCache/cache";
import { listHashes } from "../src/importCache/hash";
import { trustedListPathsForImportable } from "../src/importCache/trust";
import { estimateImportableUnits } from "../src/housingSync/progress/costs";

function chat(message: string): Action {
    return { type: "MESSAGE", message };
}

function conditional(ifActions: Action[]): Action {
    return {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [],
        ifActions,
        elseActions: [],
    };
}

function fn(actions: Action[]): ImportableFunction {
    return { type: "FUNCTION", name: "Debug", actions };
}

function cacheEntry(importable: ImportableFunction): ImportableCacheEntry {
    return {
        schemaVersion: 2,
        writtenAt: "2026-06-27T00:00:00.000Z",
        writer: "importer",
        importable,
        hash: "unused",
        lists: listHashes(importable),
    };
}

describe("trustedListPathsForImportable", () => {
    it("trusts unchanged inner lists after a top-level insertion shifts indexes", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([chat("debug"), conditional([chat("inside")])]);

        const trusted = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("actions")).toBe(false);
        expect(trusted.has("actions[1].ifActions")).toBe(true);
        expect(trusted.has("actions[0].ifActions")).toBe(false);
    });

    it("does not trust a inner list that changed under a matched parent", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([conditional([chat("debug"), chat("inside")])]);

        const trusted = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("actions")).toBe(false);
        expect(trusted.has("actions[0].ifActions")).toBe(false);
        expect(trusted.has("actions[0].elseActions")).toBe(true);
    });

    it("does not estimate top-level hydration work for trusted cached baselines", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([conditional([chat("inside"), chat("debug")])]);
        const entry = cacheEntry(cached);

        const trustOff = estimateImportableUnits(desired, entry, false);
        const trustOn = estimateImportableUnits(desired, entry, true);

        expect(trustOn).toBeLessThan(trustOff);
    });

    it("does not trust a changed top-level list", () => {
        const cached = fn([chat("old")]);
        const desired = fn([chat("new")]);
        const trustedListPaths = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trustedListPaths.has("actions")).toBe(false);
    });
});
