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
import { itemFieldObservationFromSnbt } from "../src/housingSync/items/capture";
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

    test("stack-count references share one dependency target with the item", () => {
        const owner: Importable = {
            type: "FUNCTION",
            name: "stock up",
            actions: [give("key"), give("key@8"), give("key@4")],
        };

        const dependencies = snapshot([item("key", 1), owner], owner).dependencies;

        expect(dependencies).toHaveLength(1);
        expect(dependencies[0].target).toEqual({ kind: "named", name: "key" });
    });

    test("an NBT change invalidates the fields that reference it with a count", () => {
        const plain = give("key");
        const stacked = give("key@8");
        const owner: Importable = {
            type: "FUNCTION",
            name: "stock up",
            actions: [plain, stacked],
        };
        const oldSnapshot = snapshot([item("key", 1), owner], owner);
        const currentImportables = [item("key", 2), owner];
        const index = createItemDependencyIndex(
            currentImportables,
            createProjectItemIndex(currentImportables)
        );

        const invalidations = index.invalidationsFor(owner, oldSnapshot);

        expect(invalidations.isFieldInvalidated(plain, "itemName")).toBe(true);
        expect(invalidations.isFieldInvalidated(stacked, "itemName")).toBe(true);
    });

    test("a reference's stack count does not reach the item's fingerprint", () => {
        const dependenciesFor = (reference: string) => {
            const owner: Importable = {
                type: "FUNCTION",
                name: "stock up",
                actions: [give(reference)],
            };
            return snapshot([item("key", 1), owner], owner).dependencies;
        };

        expect(dependenciesFor("key@8")).toEqual(dependenciesFor("key"));
        expect(dependenciesFor("key@4")).toEqual(dependenciesFor("key"));
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

    test("trust-off observations reach item conditions on a root container", () => {
        const desiredCondition = {
            type: "REQUIRE_ITEM",
            itemName: "key",
        } as const;
        const desiredAction = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [desiredCondition],
            ifActions: [],
            elseActions: [],
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
            observedAction as Extract<Action, { type: "CONDITIONAL" }>
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

    test("trust-off matches a recaptured wool item instead of the editor chrome", () => {
        const wool: ImportableItem = {
            type: "ITEM",
            name: "white_wool",
            nbt: {
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:wool" },
                    Count: { type: "byte", value: 1 },
                    Damage: { type: "short", value: 0 },
                },
            },
        };
        const desiredAction = {
            type: "DROP_ITEM",
            itemName: "white_wool",
        } as Action;
        const owner: Importable = {
            type: "FUNCTION",
            name: "drop wool",
            actions: [desiredAction],
        };
        const importables = [wool, owner];
        const registry = createProjectItemIndex(importables);
        const index = createItemDependencyIndex(importables, registry);
        const observations = createItemFieldObservationRecorder();
        const observedAction = JSON.parse(JSON.stringify(desiredAction)) as Action;
        const editorChrome =
            "{id:\"minecraft:wool\",Damage:0s,tag:{overrideMeta:1b,HideFlags:255,display:{Name:\"§aItem\",Lore:[\"Current Value:\",\"Wool\",\"Click to change!\"]},AttributeModifiers:[]}}";
        const recaptured = '{id:"minecraft:wool",Count:1b,Damage:0s}';
        const observation = itemFieldObservationFromSnbt(recaptured);
        observations.record(observedAction, "itemName", observation);
        const context = createItemDiffContext(
            [owner],
            index,
            registry,
            undefined,
            () => index.snapshotOf(owner),
            observations
        );

        expect(itemFieldObservationFromSnbt(editorChrome).canonicalKey).not.toBe(
            canonicalItemShellTagKey(wool.nbt)
        );
        expect(observation.canonicalKey).toBe(canonicalItemShellTagKey(wool.nbt));
        expect(context.actionsDiffer(observedAction, desiredAction)).toBe(false);
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
