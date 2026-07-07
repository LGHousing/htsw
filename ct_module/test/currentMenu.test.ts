import { describe, expect, test } from "vitest";
import { baseMenuTitle } from "../src/housingSync/menus/currentMenu";

describe("baseMenuTitle", () => {
    test("returns a plain title unchanged", () => {
        expect(baseMenuTitle("NPCs")).toBe("NPCs");
        expect(baseMenuTitle("Permissions and Groups")).toBe("Permissions and Groups");
    });

    test("strips a paginated (page/total) prefix so any page matches", () => {
        expect(baseMenuTitle("(2/3) NPCs")).toBe("NPCs");
        expect(baseMenuTitle("(1/1) NPCs")).toBe("NPCs");
        expect(baseMenuTitle("(12/40) NPCs")).toBe("NPCs");
    });

    test("only strips a leading prefix, not parenthetical text elsewhere", () => {
        expect(baseMenuTitle("Region (spawn)")).toBe("Region (spawn)");
        expect(baseMenuTitle("(x/y) not a page")).toBe("(x/y) not a page");
    });
});
