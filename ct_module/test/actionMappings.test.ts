import { describe, expect, test } from "vitest";

import { parseActionListItem } from "../src/housingSync/fields/actionMappings";

function slotWithLore(lore: string[]) {
    return {
        getItem: () => ({
            getLore: () => lore,
        }),
    } as never;
}

describe("parseActionListItem", () => {
    test("defaults Change Variable holder to player when Housing omits holder lore", () => {
        expect(parseActionListItem(slotWithLore([
            "Variable: clicks",
            "Operation: Set",
            "Value: 1",
            "",
            "Click to edit!",
        ]), "CHANGE_VAR")).toMatchObject({
            type: "CHANGE_VAR",
            holder: { type: "Player" },
            key: "clicks",
            op: "Set",
            value: "1",
        });
    });

    test("keeps explicit team holder", () => {
        expect(parseActionListItem(slotWithLore([
            "Holder: Team",
            "Team: Blue",
            "Variable: score",
            "Operation: Increment",
            "Value: 1",
        ]), "CHANGE_VAR")).toMatchObject({
            type: "CHANGE_VAR",
            holder: { type: "Team", team: "Blue" },
            key: "score",
            op: "Increment",
            value: "1",
        });
    });

    test("keeps Not Set locations for export", () => {
        expect(parseActionListItem(slotWithLore([
            "Location: Not Set",
            "Prevent Teleport Inside Blocks: Disabled",
        ]), "TELEPORT")).toMatchObject({
            type: "TELEPORT",
            location: { type: "Not Set" },
            preventTeleportInsideBlocks: false,
        });
    });
});
