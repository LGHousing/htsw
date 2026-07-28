import { describe, expect, it } from "vitest";

import { unresolvedHousingSoundLabels } from "./helpers/soundCatalogue";

const PAGE_ONE_HOUSING_SOUND_LABELS = [
    "Donkey Hit",
    "Zombie Pig Hurt",
    "Ghast Scream",
    "Creeper Death",
    "Note Bass",
    "Guardian Land Idle",
    "Wither Death",
    "Horse Zombie Death",
    "Zombie Pig Idle",
    "Entity Armor Stand Hit",
    "Entity Cow Milk",
    "Entity Arrow Hit",
    "Entity Bat Loop",
    "Entity Ender Dragon Growl",
    "Entity Skeleton Shoot",
    "Entity Zombie Destroy Egg",
    "Block Sand Place",
    "Block Soul Sand Fall",
    "Block Dispenser Fail",
    "Item Flintandsteel Use",
    "Music Creative",
] as const;

describe("Housing sound catalogue audit", () => {
    it("reports page-one labels whose normalized values are absent from SOUNDS", () => {
        expect(unresolvedHousingSoundLabels(PAGE_ONE_HOUSING_SOUND_LABELS)).toEqual([
            "Entity Armor Stand Hit",
            "Entity Cow Milk",
            "Entity Arrow Hit",
            "Entity Bat Loop",
            "Entity Ender Dragon Growl",
            "Entity Skeleton Shoot",
            "Entity Zombie Destroy Egg",
            "Block Sand Place",
            "Block Soul Sand Fall",
            "Block Dispenser Fail",
            "Item Flintandsteel Use",
            "Music Creative",
        ]);
    });

    it("accepts catalogue names, underscored names, and paths", () => {
        expect(
            unresolvedHousingSoundLabels([
                "Arrow Hit",
                "arrow_hit",
                "random.bowhit",
                "minecraft:random.bowhit",
            ])
        ).toEqual([]);
    });

    it("reports the label previously special-cased by this PR", () => {
        expect(unresolvedHousingSoundLabels(["Entity Enderman Teleport"])).toEqual([
            "Entity Enderman Teleport",
        ]);
    });
});
