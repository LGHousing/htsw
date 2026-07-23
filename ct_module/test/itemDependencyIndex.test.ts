import { describe, expect, test } from "vitest";
import type { Tag } from "htsw/nbt";
import type { Action, Importable, ImportableItem } from "htsw/types";

import {
    createItemDependencyIndex,
    type ItemDependencySnapshot,
} from "../src/importables/items/dependencyIndex";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemDiffContext } from "../src/importables/items/diff";
import { createItemFieldObservationRecorder } from "../src/housingSync/items/fieldObservations";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import {
    createItemVerificationTracker,
    verifiedItemDependencies,
} from "../src/importables/items/verifiedDependencies";

function item(name: string, marker: number, actions?: Action[]): ImportableItem {
    const nbt: Tag = {
        type: "compound",
        value: {
            id: { type: "string", value: "minecraft:stone" },
            tag: {
                type: "compound",
                value: { marker: { type: "int", value: marker } },
            },
        },
    };
    return { type: "ITEM", name, nbt, leftClickActions: actions };
}

function give(itemName: string): Action {
    return { type: "GIVE_ITEM", itemName };
}

function snapshot(importables: Importable[], owner: Importable): ItemDependencySnapshot {
    const registry = createProjectItemIndex(importables);
    return createItemDependencyIndex(importables, registry).snapshotOf(owner);
}

describe("item dependency index", () => {
    test("an NBT change invalidates each action and nested condition that uses the item", () => {
        const giveAction = give("key");
        const condition = { type: "REQUIRE_ITEM", itemName: "key" } as const;
        const conditional = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [condition],
            ifActions: [],
            elseActions: [],
        } as Action;
        const owner: Importable = {
            type: "FUNCTION",
            name: "use key",
            actions: [giveAction, conditional],
        };
        const oldSnapshot = snapshot([item("key", 1), owner], owner);
        const currentImportables = [item("key", 2), owner];
        const registry = createProjectItemIndex(currentImportables);
        const index = createItemDependencyIndex(currentImportables, registry);

        const invalidations = index.invalidationsFor(owner, oldSnapshot);

        expect(invalidations.isFieldInvalidated(giveAction, "itemName")).toBe(true);
        expect(invalidations.isFieldInvalidated(condition, "itemName")).toBe(true);
        expect(invalidations.hasInvalidatedSubtree(conditional)).toBe(true);
    });

    test("click-action fingerprints exclude the owner's NBT and include referenced NBT", () => {
        const firstKey = item("key", 1);
        const firstOwner = item("button", 1, [give("key")]);
        const firstImportables = [firstKey, firstOwner];
        const firstIndex = createItemDependencyIndex(
            firstImportables,
            createProjectItemIndex(firstImportables)
        );
        const first = firstIndex.clickActionsFingerprint(firstOwner);

        const cosmeticOwnerChange = item("button", 2, [give("key")]);
        const cosmeticImportables = [firstKey, cosmeticOwnerChange];
        const cosmeticIndex = createItemDependencyIndex(
            cosmeticImportables,
            createProjectItemIndex(cosmeticImportables)
        );
        expect(cosmeticIndex.clickActionsFingerprint(cosmeticOwnerChange)).toBe(first);

        const changedKey = item("key", 2);
        const dependencyImportables = [changedKey, cosmeticOwnerChange];
        const dependencyIndex = createItemDependencyIndex(
            dependencyImportables,
            createProjectItemIndex(dependencyImportables)
        );
        expect(dependencyIndex.clickActionsFingerprint(cosmeticOwnerChange)).not.toBe(
            first
        );
    });

    test("reports recursive click-action items without recursing forever", () => {
        const first = item("first", 1, [give("second")]);
        const second = item("second", 1, [give("first")]);
        const importables = [first, second];
        const index = createItemDependencyIndex(
            importables,
            createProjectItemIndex(importables)
        );

        expect(
            index.cycles.some(
                (cycle) => cycle.itemNames.join(" -> ") === "first -> second -> first"
            )
        ).toBe(true);
    });

    test("trust-off observations reach item conditions inside nested actions", () => {
        const desiredCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as const;
        const desiredAction = {
            type: "RANDOM",
            actions: [
                {
                    type: "CONDITIONAL",
                    matchAny: false,
                    conditions: [desiredCondition],
                    ifActions: [],
                    elseActions: [],
                },
            ],
        } as Action;
        const owner: Importable = {
            type: "FUNCTION",
            name: "nested",
            actions: [desiredAction],
        };
        const importables = [item("key", 1), owner];
        const registry = createProjectItemIndex(importables);
        const index = createItemDependencyIndex(importables, registry);
        const observations = createItemFieldObservationRecorder();
        const observedAction = JSON.parse(JSON.stringify(desiredAction)) as Action;
        const observedCondition = (
            (observedAction as Extract<Action, { type: "RANDOM" }>).actions[0] as Extract<
                Action,
                { type: "CONDITIONAL" }
            >
        ).conditions[0];
        observations.record(observedCondition, "itemName", {
            snbt: "{}",
            canonicalKey: "different",
        });
        const context = createItemDiffContext(
            [owner],
            index,
            registry,
            undefined,
            () => index.snapshotOf(owner),
            observations
        );

        expect(context.actionsDiffer(observedAction, desiredAction)).toBe(true);
    });

    test("trust-off rejects stale click data on an item with no click actions", () => {
        const key = item("key", 1);
        const desiredAction = give("key");
        const owner: Importable = {
            type: "FUNCTION",
            name: "use key",
            actions: [desiredAction],
        };
        const importables = [key, owner];
        const registry = createProjectItemIndex(importables);
        const index = createItemDependencyIndex(importables, registry);
        const observations = createItemFieldObservationRecorder();
        const observedAction = give("key");
        observations.record(observedAction, "itemName", {
            snbt: '{id:"minecraft:stone",tag:{marker:1,ExtraAttributes:{interact_data:{stale:1}}}}',
            canonicalKey: canonicalItemShellTagKey(key.nbt),
        });
        const context = createItemDiffContext(
            [owner],
            index,
            registry,
            undefined,
            () => index.snapshotOf(owner),
            observations
        );

        expect(context.actionsDiffer(observedAction, desiredAction)).toBe(true);
    });

    test("verified dependency snapshots include every fully observed target", () => {
        const first = item("first", 1);
        const second = item("second", 2);
        const desiredActions = [give("first"), give("second")];
        const owner: Importable = {
            type: "FUNCTION",
            name: "uses both",
            actions: desiredActions,
        };
        const importables = [first, second, owner];
        const registry = createProjectItemIndex(importables);
        const index = createItemDependencyIndex(importables, registry);
        const observations = createItemFieldObservationRecorder();
        const tracker = createItemVerificationTracker();
        const observedActions = [give("first"), give("second")];
        for (let i = 0; i < desiredActions.length; i++) {
            tracker.recordPair(desiredActions[i], observedActions[i]);
            const dependency = i === 0 ? first : second;
            observations.record(observedActions[i], "itemName", {
                snbt: "{}",
                canonicalKey: canonicalItemShellTagKey(dependency.nbt),
            });
        }

        expect(
            verifiedItemDependencies(
                owner,
                index,
                registry,
                "house",
                tracker,
                observations,
                new WeakSet(),
                undefined
            )
        ).toEqual(index.snapshotOf(owner));
    });

    test("verified dependency snapshots omit only an unverified target", () => {
        const first = item("first", 1);
        const second = item("second", 2);
        const desiredActions = [give("first"), give("second")];
        const owner: Importable = {
            type: "FUNCTION",
            name: "uses both",
            actions: desiredActions,
        };
        const importables = [first, second, owner];
        const registry = createProjectItemIndex(importables);
        const index = createItemDependencyIndex(importables, registry);
        const observations = createItemFieldObservationRecorder();
        const tracker = createItemVerificationTracker();
        const observedActions = [give("first"), give("second")];
        for (let i = 0; i < desiredActions.length; i++) {
            tracker.recordPair(desiredActions[i], observedActions[i]);
        }
        observations.record(observedActions[0], "itemName", {
            snbt: "{}",
            canonicalKey: canonicalItemShellTagKey(first.nbt),
        });

        const verified = verifiedItemDependencies(
            owner,
            index,
            registry,
            "house",
            tracker,
            observations,
            new WeakSet(),
            undefined
        );

        expect(verified.dependencies).toEqual([
            index.snapshotOf(owner).dependencies.find(
                (dependency) =>
                    dependency.target.kind === "named" &&
                    dependency.target.name === "first"
            ),
        ]);
        expect(verified).not.toEqual(index.snapshotOf(owner));
    });
});
