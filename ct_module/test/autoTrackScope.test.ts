import { beforeEach, describe, expect, test, vi } from "vitest";

const HOUSE_A = "aaaa-1111";
const HOUSE_B = "bbbb-2222";

const tracked = new Set<string>();
const bindings = new Map<string, string | null>();
let currentHouse: string | null = null;

vi.mock("../src/gui/state/autoTrack", () => ({
    getAutoTrackSources: () => tracked,
}));

vi.mock("../src/gui/state/housing", () => ({
    getHousingUuid: () => currentHouse,
}));

vi.mock("../src/gui/parsing/parses", () => ({
    canonicalPath: (path: string) => path.replace(/\\/g, "/").toLowerCase(),
    getParseAt: (path: string) => {
        if (!bindings.has(path)) return null;
        return { parsed: { importJson: { houseUuid: bindings.get(path) } } };
    },
}));

import {
    autoTrackBlock,
    autoTrackBoundHouse,
    getActiveAutoTrackSources,
    isAutoTrackActive,
} from "../src/gui/autoTrackScope";

describe("auto-track bound-house scope", () => {
    beforeEach(() => {
        tracked.clear();
        bindings.clear();
        currentHouse = null;
    });

    test("a project bound to the house you're in is active", () => {
        tracked.add("/a/import.json");
        bindings.set("/a/import.json", HOUSE_A);
        currentHouse = HOUSE_A;

        expect(autoTrackBlock("/a/import.json")).toBeNull();
        expect(isAutoTrackActive("/A/Import.json")).toBe(true);
        expect(Array.from(getActiveAutoTrackSources())).toEqual(["/a/import.json"]);
    });

    test("staying tracked while standing in another house does not make it active", () => {
        tracked.add("/a/import.json");
        bindings.set("/a/import.json", HOUSE_A);
        currentHouse = HOUSE_B;

        expect(autoTrackBlock("/a/import.json")).toBe("elsewhere");
        expect(autoTrackBoundHouse("/a/import.json")).toBe(HOUSE_A);
        expect(getActiveAutoTrackSources().size).toBe(0);
    });

    test("leaving every house deactivates without clearing the tracked set", () => {
        tracked.add("/a/import.json");
        bindings.set("/a/import.json", HOUSE_A);

        expect(getActiveAutoTrackSources().size).toBe(0);
        expect(tracked.has("/a/import.json")).toBe(true);
    });

    test("an unbound or unparsed project is never active", () => {
        tracked.add("/unbound/import.json");
        tracked.add("/unparsed/import.json");
        bindings.set("/unbound/import.json", null);
        currentHouse = HOUSE_A;

        expect(autoTrackBlock("/unbound/import.json")).toBe("unbound");
        expect(autoTrackBlock("/unparsed/import.json")).toBe("unbound");
        expect(getActiveAutoTrackSources().size).toBe(0);
    });

    test("only the projects bound to the current house stay active", () => {
        tracked.add("/a/import.json");
        tracked.add("/b/import.json");
        bindings.set("/a/import.json", HOUSE_A);
        bindings.set("/b/import.json", HOUSE_B);
        currentHouse = HOUSE_B;

        expect(Array.from(getActiveAutoTrackSources())).toEqual(["/b/import.json"]);
    });
});
