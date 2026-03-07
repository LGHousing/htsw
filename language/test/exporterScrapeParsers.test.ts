import { describe, expect, it } from "vitest";
import {
    mapActionDisplayName,
    parseBooleanCurrentValue,
    parseLocationCurrentValue,
    parseNumberCurrentValue,
    parseOperationCurrentValue,
    parseSoundCurrentValue,
    parseVarOperationCurrentValue,
} from "../../ct_module/src/exporter/scrapeParsers";

describe("Exporter scrape parsers", () => {
    it("maps action display names", () => {
        expect(mapActionDisplayName("Send a Chat Message")).toBe("MESSAGE");
        expect(mapActionDisplayName("Display Action Bar")).toBe("ACTION_BAR");
        expect(mapActionDisplayName("Random Action (1/3)")).toBe("RANDOM");
        expect(mapActionDisplayName("Display Action Bar [slot 11]")).toBe("ACTION_BAR");
        expect(mapActionDisplayName("Not An Action")).toBeUndefined();
    });

    it("parses booleans", () => {
        expect(parseBooleanCurrentValue("Enabled")).toBe(true);
        expect(parseBooleanCurrentValue("Disabled")).toBe(false);
        expect(parseBooleanCurrentValue("true")).toBe(true);
        expect(parseBooleanCurrentValue("false")).toBe(false);
        expect(parseBooleanCurrentValue("maybe")).toBeUndefined();
    });

    it("parses numbers", () => {
        expect(parseNumberCurrentValue("12")).toBe(12);
        expect(parseNumberCurrentValue("1,234")).toBe(1234);
        expect(parseNumberCurrentValue("  42  ")).toBe(42);
        expect(parseNumberCurrentValue("12abc")).toBeUndefined();
        expect(parseNumberCurrentValue("abc")).toBeUndefined();
    });

    it("parses locations", () => {
        expect(parseLocationCurrentValue("House Spawn Location")).toEqual({
            type: "House Spawn Location",
        });
        expect(parseLocationCurrentValue("Invokers Location")).toEqual({
            type: "Invokers Location",
        });
        expect(parseLocationCurrentValue("Current Location")).toEqual({
            type: "Current Location",
        });
        expect(parseLocationCurrentValue("Custom Coordinates 1 2 3")).toEqual({
            type: "Custom Coordinates",
            value: "1 2 3",
        });
    });

    it("parses operation names", () => {
        expect(parseOperationCurrentValue("Set")).toBe("Set");
        expect(parseOperationCurrentValue("increment")).toBe("Increment");
        expect(parseVarOperationCurrentValue("Unset")).toBe("Unset");
        expect(parseVarOperationCurrentValue("And Assign")).toBe("And Assign");
    });

    it("parses sounds by path and display name", () => {
        expect(parseSoundCurrentValue("mob.cat.meow")).toBe("mob.cat.meow");
        expect(parseSoundCurrentValue("Cat Meow")).toBe("mob.cat.meow");
    });
});
