import { describe, expect, it } from "vitest";
import type {
    Action,
    ImportableCommand,
    ImportableFunction,
    ImportableNpc,
} from "htsw/types";

import type { ImportableCacheEntry } from "../src/importCache/cache";
import { listHashes } from "../src/importCache/hash";
import { hasTrustedActionListBaseline } from "../src/importables/actionListHelpers";
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
    it("trusts unchanged nested lists after a top-level insertion shifts indexes", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([chat("debug"), conditional([chat("inside")])]);

        const trusted = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("actions")).toBe(false);
        expect(trusted.has("actions[1].ifActions")).toBe(true);
        expect(trusted.has("actions[0].ifActions")).toBe(false);
    });

    it("does not trust a nested list that changed under a matched parent", () => {
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

    it("does not treat an untrusted cached top-level list as live observed slots", () => {
        const cached = fn([chat("old")]);
        const desired = fn([chat("new")]);
        const trustedListPaths = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trustedListPaths.has("actions")).toBe(false);
        expect(hasTrustedActionListBaseline({
            importable: desired,
            identity: desired.name,
            entry: cacheEntry(cached),
            sourceHash: "unused",
            cacheHash: "unused",
            trustMode: true,
            wholeImportableTrusted: false,
            trustedListPaths,
        }, "actions")).toBe(false);
    });

    it("trusts unchanged command actions when command settings changed", () => {
        const cached: ImportableCommand = {
            type: "COMMAND",
            name: "warp",
            actions: [chat("same")],
            listed: true,
        };
        const desired: ImportableCommand = {
            type: "COMMAND",
            name: "warp",
            actions: [chat("same")],
            listed: false,
        };

        const trusted = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("actions")).toBe(true);
    });

    it("trusts unchanged NPC click action lists independently", () => {
        const cached: ImportableNpc = {
            type: "NPC",
            name: "Guide",
            pos: { x: 1, y: 2, z: 3 },
            leftClickActions: [chat("same")],
            rightClickActions: [chat("old")],
        };
        const desired: ImportableNpc = {
            type: "NPC",
            name: "Guide",
            pos: { x: 1, y: 2, z: 3 },
            leftClickActions: [chat("same")],
            rightClickActions: [chat("new")],
        };

        const trusted = trustedListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("leftClickActions")).toBe(true);
        expect(trusted.has("rightClickActions")).toBe(false);
    });
});
