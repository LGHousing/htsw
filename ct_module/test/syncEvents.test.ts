import { describe, expect, test } from "vitest";

import { applyActionListPlan } from "../src/housingSync/actions/apply";
import { type SyncEvent, type SyncEventHandler } from "../src/housingSync/syncEvents";
import { ActionPath, ActionListPath } from "../src/housingSync/actionPath";
import type { ActionListDiff } from "../src/housingSync/actions/diff/types";
import type { ActionListPlan } from "../src/housingSync/actions/plan";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createItemFieldResolver } from "../src/importables/items/resolveItem";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import { orderImportablesForSession } from "../src/importables/import/session";
import { expandDeclaredTeamAndGroupDependencies } from "../src/importables/items/dependencies";
import type {
    ImportableFunction,
    ImportableGroup,
    ImportableItem,
    ImportableTeam,
} from "htsw/types";

function recordingHandler(): SyncEventHandler & { events: SyncEvent[] } {
    const events: SyncEvent[] = [];
    return {
        events,
        emit: (event) => {
            events.push(event);
        },
    };
}

const emptyDiff: ActionListDiff = { operations: [], desiredLength: 0 };

function emptyPlan(): ActionListPlan {
    return {
        desired: [],
        observed: [],
        diff: emptyDiff,
        phaseUnits: {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: 1,
        },
    };
}

function syncContextWith(handler: SyncEventHandler): ActionSyncContext {
    const items = createProjectItemIndex([]);
    const itemDependencies = createItemDependencyIndex([], items);
    return {
        canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
        resolveItem: createItemFieldResolver(items, itemDependencies, "test-house"),
        trust: {
            housingUuid: "test-house",
            trustMode: false,
            importables: new Map(),
        },
        overwriteWarningMode: "always",
        conflicts: [],
        events: handler,
        itemRead: { mode: "sync" },
    };
}

describe("applyActionListPlan — top-level-only terminal events", () => {
    test("top-level empty-diff apply emits listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(null as never, emptyPlan(), {
            sync: syncContextWith(handler),
        });
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).toContain("listSyncCompleted");
    });

    test("child-list empty-diff apply does NOT emit listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(null as never, emptyPlan(), {
            sync: syncContextWith(handler),
            listPath: ActionListPath.childOf(ActionPath.at(undefined, 5), "ifActions"),
        });
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).not.toContain("listSyncCompleted");
        expect(kinds).not.toContain("finalizeSource");
    });
});

describe("orderImportablesForSession", () => {
    test("adds declared teams and groups referenced by selected action trees", () => {
        const team: ImportableTeam = {
            type: "TEAM",
            name: "g",
        };
        const group: ImportableGroup = {
            type: "GROUP",
            name: "vip",
        };
        const func: ImportableFunction = {
            type: "FUNCTION",
            name: "Player 5t",
            actions: [
                {
                    type: "CHANGE_VAR",
                    holder: { type: "Team", team: "g" },
                    key: "r g",
                    op: "Set",
                    value: "%var.global/p%%var.player/z% g%",
                },
                {
                    type: "CONDITIONAL",
                    matchAny: false,
                    conditions: [
                        {
                            type: "REQUIRE_GROUP",
                            group: "vip",
                        },
                    ],
                    ifActions: [],
                    elseActions: [],
                },
            ],
        };

        const result = expandDeclaredTeamAndGroupDependencies(
            [func, team, group],
            [func]
        );

        expect(result.importables).toEqual([func, team, group]);
        expect(result.addedTeams).toEqual([team]);
        expect(result.addedGroups).toEqual([group]);
    });

    test("orders teams and groups before action-bearing importables", () => {
        const team: ImportableTeam = {
            type: "TEAM",
            name: "g",
        };
        const group: ImportableGroup = {
            type: "GROUP",
            name: "vip",
        };
        const func: ImportableFunction = {
            type: "FUNCTION",
            name: "Player 5t",
            actions: [
                {
                    type: "CHANGE_VAR",
                    holder: { type: "Team", team: "g" },
                    key: "r g",
                    op: "Set",
                    value: "%var.global/p%%var.player/z% g%",
                },
            ],
        };

        expect(orderImportablesForSession([], [func, team, group])).toEqual([
            team,
            group,
            func,
        ]);
    });

    test("orders item dependencies before dependent items", () => {
        const dependency: ImportableItem = {
            type: "ITEM",
            name: "Dependency",
            nbt: { type: "compound", value: {} },
        };
        const dependent: ImportableItem = {
            type: "ITEM",
            name: "Dependent",
            nbt: { type: "compound", value: {} },
            leftClickActions: [
                {
                    type: "GIVE_ITEM",
                    itemName: "Dependency",
                    allowMultiple: false,
                    slot: 0,
                    replaceExisting: false,
                },
            ],
        };

        expect(orderImportablesForSession([], [dependent, dependency])).toEqual([
            dependency,
            dependent,
        ]);
    });
});
